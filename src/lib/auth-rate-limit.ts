import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getMysqlPool } from "@/lib/mysql";

export class AuthRequestError extends Error {
  constructor(message: string, public status = 400, public retryAfter?: number) { super(message); }
}
/** nginx 覆写该头；开发机不信任客户端自行携带的代理地址。 */
export function authClientAddress(request: Request) {
  return process.env.NODE_ENV === "production" ? request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown" : "local";
}

export async function limitAuthRequest(subject: string, maximum: number, seconds: number) {
  const pool = getMysqlPool();
  const now = Date.now();
  const start = Math.floor(now / (seconds * 1000));
  const bucket = createHash("sha256").update(subject + ":" + start).digest("hex");
  // 过期桶渐进清理；本次自增与计数读取在同一连接的事务中完成。
  await pool.execute("DELETE FROM auth_rate_limits WHERE expires_at < ? LIMIT 50", [new Date(now)]);
  const connection = await pool.getConnection();
  let count: number;
  try {
    await connection.beginTransaction();
    await connection.execute("INSERT INTO auth_rate_limits (bucket, window_start, request_count, expires_at) VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE request_count = request_count + 1", [bucket, start, new Date((start + 2) * seconds * 1000)]);
    // 上面的写锁持续到提交；其他请求不能抢先自增再影响本次序号。
    const [rows] = await connection.execute<Array<RowDataPacket & { request_count: number }>>("SELECT request_count FROM auth_rate_limits WHERE bucket = ?", [bucket]);
    count = rows[0].request_count;
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (count > maximum)
    throw new AuthRequestError("请求过于频繁，请稍后重试。", 429, Math.ceil(((start + 1) * seconds * 1000 - now) / 1000));
}
