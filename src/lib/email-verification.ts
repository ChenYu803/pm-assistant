import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getMysqlPool } from "@/lib/mysql";
import { normalizeEmail } from "@/lib/mysql-account-workspace";
import { AuthRequestError, limitAuthRequest } from "@/lib/auth-rate-limit";
import { deliverEmailCode } from "@/lib/auth-email-delivery";
import { emailNow } from "@/lib/auth-email-test-boundary";

export type EmailCodePurpose = "register" | "reset-password";

interface Challenge extends RowDataPacket {
  code_digest: string | null;
  expires_at: Date;
  sent_at: Date;
  attempts: number;
  state: string;
}

export function validatedEmail(value: unknown) {
  if (typeof value !== "string")
    throw new AuthRequestError("请输入邮箱地址。");
  const email = normalizeEmail(value);
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AuthRequestError("邮箱格式不正确。");
  return email;
}

export function validatedPassword(value: unknown) {
  if (typeof value !== "string" || value.length < 6 || Buffer.byteLength(value, "utf8") > 72)
    throw new AuthRequestError("密码至少 6 位，且不能超过 72 字节。");
  return value;
}

function digest(email: string, purpose: EmailCodePurpose, code: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("验证码服务密钥未配置");
  return createHmac("sha256", secret).update(JSON.stringify([email, purpose, code])).digest("hex");
}

async function transaction<T>(run: (connection: PoolConnection) => Promise<T>) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await run(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function sendEmailCode(email: string, purpose: EmailCodePurpose, address: string) {
  await limitAuthRequest("send-ip:" + address, 30, 3600);
  await limitAuthRequest("send-email:" + email, 6, 3600);
  const now = await emailNow();
  let code = randomInt(0, 1000000).toString().padStart(6, "0");
  let codeDigest = digest(email, purpose, code);
  await transaction(async (connection) => {
    // 先插槽再行锁，发送与验证使用同一个锁；重发立即废弃旧码。
    await connection.execute("INSERT IGNORE INTO email_verifications (email, purpose, expires_at, sent_at, state) VALUES (?, ?, ?, ?, 'empty')", [email, purpose, now, new Date(0)]);
    const [rows] = await connection.execute<Challenge[]>("SELECT * FROM email_verifications WHERE email = ? AND purpose = ? FOR UPDATE", [email, purpose]);
    if (rows[0].code_digest === codeDigest) {
      code = ((Number(code) + 1) % 1000000).toString().padStart(6, "0");
      codeDigest = digest(email, purpose, code);
    }
    const remaining = Math.ceil((new Date(rows[0].sent_at).getTime() + 60000 - now.getTime()) / 1000);
    if (remaining > 0)
      throw new AuthRequestError("请等待 " + remaining + " 秒后重新发送。", 429, remaining);
    const [users] = await connection.execute<RowDataPacket[]>("SELECT id, email FROM users WHERE email = ?", [email]);
    if (purpose === "register" && users.length)
      throw new AuthRequestError("该邮箱已被注册，请直接登录或找回密码。", 409);
    // users 的历史排序规则忽略重音；找回邮件必须精确匹配规范化后的真实账号地址。
    if (purpose === "reset-password" && (!users.length || users[0].email !== email))
      throw new AuthRequestError("该邮箱尚未注册，请核对邮箱地址。", 404);
    await connection.execute("UPDATE email_verifications SET code_digest = ?, expires_at = ?, sent_at = ?, attempts = 0, state = 'pending' WHERE email = ? AND purpose = ?", [codeDigest, new Date(now.getTime() + 600000), now, email, purpose]);
  });
  try {
    await deliverEmailCode(email, code, purpose);
    await getMysqlPool().execute("UPDATE email_verifications SET state = 'ready' WHERE email = ? AND purpose = ? AND code_digest = ? AND state = 'pending'", [email, purpose, codeDigest]);
  } catch (error) {
    await getMysqlPool().execute("UPDATE email_verifications SET state = 'failed', code_digest = NULL WHERE email = ? AND purpose = ? AND code_digest = ?", [email, purpose, codeDigest]);
    throw error;
  }
  return { message: "验证码已发送，10 分钟内有效；重新发送后仅最新验证码有效。", retryAfter: 60, expiresIn: 600 };
}

export async function completeEmailVerification(email: string, purpose: EmailCodePurpose, code: unknown, password: string, address: string) {
  await limitAuthRequest("verify-ip:" + address, 60, 900);
  await limitAuthRequest("verify-email:" + email, 20, 900);
  if (typeof code !== "string" || !/^\d{6}$/.test(code))
    throw new AuthRequestError("请输入 6 位数字验证码。");
  const now = await emailNow();
  const supplied = digest(email, purpose, code);
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await transaction(async (connection) => {
    const [rows] = await connection.execute<Challenge[]>("SELECT * FROM email_verifications WHERE email = ? AND purpose = ? FOR UPDATE", [email, purpose]);
    const row = rows[0];
    if (!row || row.state === "empty")
      return new AuthRequestError("请先获取对应用途的邮箱验证码。");
    if (row.state === "used")
      return new AuthRequestError("验证码已使用，请重新获取。");
    if (row.state !== "ready")
      return new AuthRequestError("验证码尚未发送成功，请稍后重新获取。");
    if (new Date(row.expires_at).getTime() <= now.getTime())
      return new AuthRequestError("验证码已过期，请重新获取。");
    if (row.attempts >= 5)
      return new AuthRequestError("验证码错误次数过多，请重新获取。", 429, 60);
    if (!row.code_digest || !timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(row.code_digest, "hex"))) {
      await connection.execute("UPDATE email_verifications SET attempts = attempts + 1 WHERE email = ? AND purpose = ?", [email, purpose]);
      return new AuthRequestError("验证码错误，请核对邮箱及用途后重试。");
    }
    let id: string;
    if (purpose === "register") {
      id = randomUUID();
      // 账号与验证码消费原子提交；后续赠送兑换在本事务成功后独立接入。
      await connection.execute("INSERT INTO users (id, email, password_hash, created_at, email_verified_at) VALUES (?, ?, ?, ?, ?)", [id, email, passwordHash, now, now]);
    }
    else {
      const [users] = await connection.execute<Array<RowDataPacket & {
        id: string;
      }>>("SELECT id FROM users WHERE email = ? AND BINARY email = BINARY ? FOR UPDATE", [email, email]);
      if (!users[0])
        return new AuthRequestError("该邮箱尚未注册。", 404);
      id = users[0].id;
      await connection.execute("UPDATE users SET password_hash = ?, email_verified_at = ? WHERE id = ?", [passwordHash, now, id]);
    }
    await connection.execute("UPDATE email_verifications SET state = 'used', code_digest = NULL WHERE email = ? AND purpose = ?", [email, purpose]);
    return { id, email };
  });
  if (result instanceof AuthRequestError)
    throw result;
  return result;
}
