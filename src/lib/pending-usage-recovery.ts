import type { RowDataPacket } from "mysql2/promise";
import { getMysqlPool } from "@/lib/mysql";
import { lockCreditUsers } from "@/lib/credits-ledger";
import { settleConversationCredits } from "@/lib/conversation-credits";
import { pendingUsageNow } from "@/lib/pending-usage-clock";

/** 数据库中的未结算调用就是持久任务；游标越过失败项，下一次调度再重试。 */
export async function recoverPendingUsage() {
  const pool = getMysqlPool();
  const result = { scanned: 0, failed: 0 };
  let cursor = "";
  while (true) {
    const now = await pendingUsageNow();
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT c.id,c.user_id FROM conversation_credit_calls c JOIN model_requests m ON m.id=c.id WHERE c.id>? AND (c.state='pending' OR (c.state='reserved' AND (m.status NOT IN ('running','processing') OR m.deadline_at<=?))) ORDER BY c.id LIMIT 100", [cursor, now]);
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.id;
      result.scanned++;
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await lockCreditUsers(connection, [row.user_id]);
        // 与供应商证据、停止和正文提交使用相同锁顺序，避免两份资金终态。
        const [calls] = await connection.execute<RowDataPacket[]>("SELECT state FROM conversation_credit_calls WHERE id=? FOR UPDATE", [row.id]);
        if (["reserved", "pending"].includes(calls[0]?.state)) {
          const current = await pendingUsageNow();
          await connection.execute("UPDATE model_requests SET status=IF(stop_requested_at IS NULL,'interrupted','stopped'),website_borne=(stop_requested_at IS NULL),ended_at=COALESCE(ended_at,?),error_code='process_deadline_exceeded' WHERE id=? AND status IN ('running','processing') AND deadline_at<=?", [current, row.id, current]);
          await settleConversationCredits(row.id, connection);
        }
        await connection.commit();
      } catch {
        await connection.rollback();
        result.failed++;
        console.error("pending_usage_recovery_failed", { requestId: row.id });
      } finally { connection.release(); }
    }
  }
  return result;
}
