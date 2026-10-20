import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { MYSQL_MIGRATIONS } from "@/lib/mysql-bootstrap";
import { mysqlVersionMatchesRequired } from "@/lib/mysql-config";

export async function checkProductionDatabase(pool: Pool) {
  const [versions] = await pool.query<Array<RowDataPacket & { version: string }>>("SELECT VERSION() AS version");
  if (!mysqlVersionMatchesRequired(versions[0].version, "9.7")) throw new Error("生产数据库必须使用 MySQL 9.7 LTS 系列");
  const [rows] = await pool.query<Array<RowDataPacket & { id: string; checksum: string }>>("SELECT id, checksum FROM schema_migrations");
  if (!MYSQL_MIGRATIONS.every((migration) => rows.some((row) => row.id === migration.id && row.checksum === migration.checksum))) throw new Error("数据库迁移未完成或校验不符，请先执行维护迁移");
  return versions[0].version;
}

/** 仅由 systemd 单实例启动前执行；必须先停旧实例，禁止作为在线修复接口调用。 */
export async function recoverProductionGenerations(pool: Pool) {
  const connection = await pool.getConnection();
  const error = "服务已重启，上次生成未完成，请重试。";
  try {
    await connection.beginTransaction();
    const [iteration] = await connection.execute<ResultSetHeader>("UPDATE iteration_session_messages SET status = 'failed', error_message = ? WHERE status = 'generating'", [error]);
    const [legacy] = await connection.execute<ResultSetHeader>("UPDATE messages SET status = 'interrupted', error_message = ? WHERE role = 'assistant' AND status = 'generating'", [error]);
    await connection.execute("UPDATE tabs SET freeze_status = 'failed', freeze_error = ? WHERE freeze_status = 'generating'", [error]);
    // 与 failMysqlTabOperation 的版本推进一致，防止重启后旧标签页永久锁住。
    await connection.execute("UPDATE tabs t JOIN tab_operations o ON o.tab_id = t.id AND o.request_id = t.active_operation_id SET t.version = COALESCE(o.locked_version, o.expected_version) + IF(o.operation = 'stop-generation', 0, 1), t.active_operation_id = NULL WHERE o.status IN ('pending', 'processing')");
    await connection.execute("UPDATE tab_operations SET status = 'failed', response_json = ?, tab_version = COALESCE(locked_version, expected_version) + IF(operation = 'stop-generation', 0, 1) WHERE status IN ('pending', 'processing')", [JSON.stringify({ error })]);
    await connection.commit();
    return { iteration: iteration.affectedRows, legacy: legacy.affectedRows };
  } catch (failure) { await connection.rollback(); throw failure; }
  finally { connection.release(); }
}
