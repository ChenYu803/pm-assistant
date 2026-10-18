import type { Pool, RowDataPacket } from "mysql2/promise";
import { getMysqlPool } from "@/lib/mysql";
import { isMysqlId } from "@/lib/identifiers";
import { positiveSetting } from "@/lib/launch-policy";

export class AIQuotaError extends Error {}

/** 北京时间每日重置；先原子占用次数再访问供应商，失败/停止不退回已开始的请求。 */
export async function reserveAIRequest(userId: string | undefined, env = process.env, pool: Pool = getMysqlPool(), now = new Date()) {
  if (!userId || !isMysqlId(userId)) throw new AIQuotaError("无法确认体验账号，请重新登录。");
  const day = new Date(now.valueOf() + 8 * 3600_000).toISOString().slice(0, 10);
  const limits = [positiveSetting("AI_DAILY_SITE_LIMIT", 100, env), positiveSetting("AI_DAILY_USER_LIMIT", 10, env)];
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // 始终先站点后账号，同日所有请求在数据库锁中串行检查，不能并发超额。
    for (const [index, subject] of ["site", userId].entries()) {
      await connection.execute("INSERT INTO ai_daily_usage (usage_day, subject, request_count) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE request_count = request_count", [day, subject]);
      const [rows] = await connection.query<Array<RowDataPacket & { request_count: number }>>("SELECT request_count FROM ai_daily_usage WHERE usage_day = ? AND subject = ? FOR UPDATE", [day, subject]);
      if (Number(rows[0].request_count) >= limits[index]) throw new AIQuotaError(index ? "今日 AI 体验次数已用完，请明天再来。" : "本站今日 AI 体验次数已用完，请明天再来。");
      await connection.execute("UPDATE ai_daily_usage SET request_count = request_count + 1 WHERE usage_day = ? AND subject = ?", [day, subject]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
