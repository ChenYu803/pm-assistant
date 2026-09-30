import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { getMysqlPool } from "@/lib/mysql";

type MysqlCascadeDeleteStep =
  | "agent-file-contexts"
  | "messages"
  | "tab-operations"
  | "tabs"
  | "work-records"
  | "project-files"
  | "prototype-snapshots";

export interface CascadeDeleteOptions {
  failAfterStep?: MysqlCascadeDeleteStep;
}

export function getCascadeDeleteTestOptions(request: Request): CascadeDeleteOptions {
  if (process.env.CASCADE_DELETE_TEST_HOOKS !== "1") return {};
  const step = request.headers.get("x-pm-assistant-test-cascade-fail-after");
  const steps: MysqlCascadeDeleteStep[] = ["agent-file-contexts", "messages", "tab-operations", "tabs", "work-records", "project-files", "prototype-snapshots"];
  return steps.includes(step as MysqlCascadeDeleteStep) ? { failAfterStep: step as MysqlCascadeDeleteStep } : {};
}

type OwnedProjectRow = RowDataPacket & { id: string };
type OwnedWorkRecordRow = RowDataPacket & { id: string; project_id: string };
type IdRow = RowDataPacket & { id: string };

export interface MysqlCascadeDeleteResult {
  mode: "transaction";
}

function testFailure(step: MysqlCascadeDeleteStep, options: CascadeDeleteOptions) {
  if (options.failAfterStep === step) {
    throw new Error(`级联删除测试故障：${step} 已清理`);
  }
}

async function clean(
  connection: PoolConnection,
  label: string,
  step: MysqlCascadeDeleteStep,
  removeSql: string,
  remainingSql: string,
  values: string[],
  options: CascadeDeleteOptions
) {
  await connection.execute<ResultSetHeader>(removeSql, values);
  const [rows] = await connection.query<Array<RowDataPacket & { count: number }>>(
    remainingSql,
    values
  );
  if (Number(rows[0]?.count ?? 0) !== 0) {
    throw new Error(`${label} 清理未完成，剩余 ${rows[0]?.count ?? 0} 条记录`);
  }
  testFailure(step, options);
}

async function lockOwnedProject(
  connection: PoolConnection,
  projectId: string,
  userId: string
) {
  const [rows] = await connection.query<OwnedProjectRow[]>(
    "SELECT id FROM projects WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE",
    [projectId, userId]
  );
  return rows[0] ?? null;
}

async function lockOwnedWorkRecord(
  connection: PoolConnection,
  workRecordId: string,
  userId: string
) {
  const [rows] = await connection.query<OwnedWorkRecordRow[]>(
    `SELECT w.id, w.project_id
     FROM work_records w
     JOIN projects p ON p.id = w.project_id
     WHERE w.id = ? AND p.user_id = ? LIMIT 1 FOR UPDATE`,
    [workRecordId, userId]
  );
  return rows[0] ?? null;
}

async function listTabIds(
  connection: PoolConnection,
  workRecordIds: string[]
): Promise<string[]> {
  if (workRecordIds.length === 0) return [];
  const placeholders = workRecordIds.map(() => "?").join(", ");
  const [rows] = await connection.query<IdRow[]>(
    `SELECT id FROM tabs WHERE work_record_id IN (${placeholders}) FOR UPDATE`,
    workRecordIds
  );
  return rows.map((row) => row.id);
}

async function clearTabOwnedData(
  connection: PoolConnection,
  tabIds: string[],
  options: CascadeDeleteOptions
) {
  if (tabIds.length === 0) return;
  const placeholders = tabIds.map(() => "?").join(", ");
  const tabFilter = `tab_id IN (${placeholders})`;

  await clean(
    connection,
    "文件上下文",
    "agent-file-contexts",
    `DELETE FROM agent_file_contexts WHERE ${tabFilter}`,
    `SELECT COUNT(*) AS count FROM agent_file_contexts WHERE ${tabFilter}`,
    tabIds,
    options
  );
  await connection.execute<ResultSetHeader>(
    `DELETE FROM message_file_writes WHERE ${tabFilter}`,
    tabIds
  );

  // 消息恢复链允许同一删除范围内的消息互相引用，先解除所有指向这些消息的引用，
  // 才能让 MySQL 的外键在删除消息行时继续作为完整性边界。
  const [messageRows] = await connection.query<IdRow[]>(
    `SELECT id FROM messages WHERE ${tabFilter} FOR UPDATE`,
    tabIds
  );
  const messageIds = messageRows.map((row) => row.id);
  if (messageIds.length > 0) {
    const messagePlaceholders = messageIds.map(() => "?").join(", ");
    await connection.execute<ResultSetHeader>(
      `UPDATE messages
       SET replacement_target_id = NULL,
           replacement_commit_message_id = NULL,
           superseded_by_message_id = NULL,
           replacement_user_message_id = NULL
       WHERE tab_id IN (${placeholders})
         AND (replacement_target_id IN (${messagePlaceholders})
          OR replacement_commit_message_id IN (${messagePlaceholders})
          OR superseded_by_message_id IN (${messagePlaceholders})
          OR replacement_user_message_id IN (${messagePlaceholders}))`,
      [...tabIds, ...messageIds, ...messageIds, ...messageIds, ...messageIds]
    );
  }
  await clean(
    connection,
    "消息",
    "messages",
    `DELETE FROM messages WHERE ${tabFilter}`,
    `SELECT COUNT(*) AS count FROM messages WHERE ${tabFilter}`,
    tabIds,
    options
  );
  await clean(
    connection,
    "标签页操作记录",
    "tab-operations",
    `DELETE FROM tab_operations WHERE ${tabFilter}`,
    `SELECT COUNT(*) AS count FROM tab_operations WHERE ${tabFilter}`,
    tabIds,
    options
  );
  await clean(
    connection,
    "标签页",
    "tabs",
    `DELETE FROM tabs WHERE id IN (${placeholders})`,
    `SELECT COUNT(*) AS count FROM tabs WHERE id IN (${placeholders})`,
    tabIds,
    options
  );
}

/**
 * MySQL 删除始终在一个事务中完成。项目行锁会与成果写入等项目级事务串行；
 * 外键则阻止没有取得同一把锁的迟到写入在父级提交后留下孤儿。
 */
export async function deleteMysqlWorkRecordCascade(
  workRecordId: string,
  userId: string,
  options: CascadeDeleteOptions = {}
): Promise<MysqlCascadeDeleteResult | null> {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const workRecord = await lockOwnedWorkRecord(connection, workRecordId, userId);
    if (!workRecord) {
      await connection.rollback();
      return null;
    }
    await clearTabOwnedData(connection, await listTabIds(connection, [workRecord.id]), options);
    await clean(
      connection,
      "工作记录",
      "work-records",
      "DELETE FROM work_records WHERE id = ?",
      "SELECT COUNT(*) AS count FROM work_records WHERE id = ?",
      [workRecord.id],
      options
    );
    await connection.commit();
    return { mode: "transaction" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function deleteMysqlProjectCascade(
  projectId: string,
  userId: string,
  options: CascadeDeleteOptions = {}
): Promise<MysqlCascadeDeleteResult | null> {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    if (!(await lockOwnedProject(connection, projectId, userId))) {
      await connection.rollback();
      return null;
    }
    // 先锁定新工作台的迭代，阻止生成预留和新会话在清理期间插入。
    // 显式删除消息，避免多级级联留下过程消息；与项目资产清理共用同一事务。
    await connection.query<IdRow[]>(
      "SELECT id FROM product_iterations WHERE project_id = ? ORDER BY iteration_number FOR UPDATE", [projectId]);
    await connection.execute<ResultSetHeader>(
      `DELETE FROM iteration_session_messages WHERE session_id IN (
         SELECT s.id FROM iteration_sessions s JOIN product_iterations i ON i.id = s.iteration_id
         WHERE i.project_id = ?
       )`, [projectId]);
    await connection.execute<ResultSetHeader>("DELETE FROM product_iterations WHERE project_id = ?", [projectId]);
    const [workRecordRows] = await connection.query<IdRow[]>(
      "SELECT id FROM work_records WHERE project_id = ? FOR UPDATE",
      [projectId]
    );
    const workRecordIds = workRecordRows.map((row) => row.id);
    await clearTabOwnedData(connection, await listTabIds(connection, workRecordIds), options);
    await clean(
      connection,
      "工作记录",
      "work-records",
      "DELETE FROM work_records WHERE project_id = ?",
      "SELECT COUNT(*) AS count FROM work_records WHERE project_id = ?",
      [projectId],
      options
    );
    await clean(
      connection,
      "项目文件",
      "project-files",
      "DELETE FROM project_files WHERE project_id = ?",
      "SELECT COUNT(*) AS count FROM project_files WHERE project_id = ?",
      [projectId],
      options
    );
    await clean(
      connection,
      "原型快照",
      "prototype-snapshots",
      "DELETE FROM prototype_snapshots WHERE project_id = ?",
      "SELECT COUNT(*) AS count FROM prototype_snapshots WHERE project_id = ?",
      [projectId],
      options
    );
    const [result] = await connection.execute<ResultSetHeader>(
      "DELETE FROM projects WHERE id = ? AND user_id = ?",
      [projectId, userId]
    );
    if (result.affectedRows !== 1) throw new Error("项目清理未完成");
    await connection.commit();
    return { mode: "transaction" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
