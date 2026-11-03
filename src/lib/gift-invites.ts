import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getMysqlPool } from "@/lib/mysql";
import { lockCreditUsers } from "@/lib/credits-ledger";
import { creditText, creditUnits, type CreditBalance } from "@/lib/credit-values";
import { isDesignatedAdmin } from "@/lib/account-controls";

const BATCH_ID = "v144-first-100";
const GIFT_AMOUNT = "2000";
export class GiftInviteError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function digest(code: string) { return createHash("sha256").update(code).digest("hex"); }
function normalizeCode(code: unknown) {
  if (typeof code !== "string" || code.length > 64) throw new GiftInviteError("请输入有效的邀请码。");
  const value = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{8,64}$/.test(value)) throw new GiftInviteError("请输入有效的邀请码。");
  return value;
}
function codeValue() { return randomBytes(15).toString("base64url").toUpperCase(); }
async function balance(connection: PoolConnection, userId: string): Promise<CreditBalance> {
  const [rows] = await connection.execute<RowDataPacket[]>("SELECT kind, SUM(available) AS available, SUM(reserved) AS reserved FROM credit_sources WHERE user_id = ? GROUP BY kind", [userId]);
  const value: CreditBalance = { gift: { available: "0", reserved: "0" }, purchased: { available: "0", reserved: "0" } };
  for (const row of rows) value[row.kind as keyof CreditBalance] = { available: creditText(creditUnits(String(row.available))), reserved: creditText(creditUnits(String(row.reserved))) };
  return value;
}
async function assertAdmin(connection: PoolConnection, actorId: string) {
  const users = await lockCreditUsers(connection, [actorId]);
  const actor = users[0];
  if (!actor || actor.account_status !== "active" || !isDesignatedAdmin(actor.email)) throw new GiftInviteError("无权访问管理功能。", 403);
  return actor;
}

export async function hasGiftRedemption(userId: string) {
  const [rows] = await getMysqlPool().execute<RowDataPacket[]>("SELECT id, credits, created_at AS createdAt FROM gift_invite_redemptions WHERE user_id = ?", [userId]);
  return rows[0] ? { redeemed: true, credits: String(rows[0].credits), createdAt: new Date(rows[0].createdAt).toISOString() } : { redeemed: false };
}

export async function redeemGiftInvite(userId: string, rawCode: unknown, requestId: string) {
  const code = normalizeCode(rawCode);
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(requestId)) throw new GiftInviteError("兑换请求标识无效，请重新提交。");
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();
    const users = await lockCreditUsers(connection, [userId]);
    const user = users[0];
    if (!user || user.account_status !== "active") throw new GiftInviteError("账号不可用，请重新登录。", 403);
    const [prior] = await connection.execute<RowDataPacket[]>("SELECT r.*, c.code_digest FROM gift_invite_redemptions r JOIN gift_invite_codes c ON c.id = r.code_id WHERE r.user_id = ? FOR UPDATE", [userId]);
    if (prior.length) {
      if (prior[0].code_digest !== digest(code)) throw new GiftInviteError("该账号已领取过赠送积分；当前邀请码未被领取。", 409);
      const [request] = await connection.execute<RowDataPacket[]>("SELECT id FROM gift_invite_redemptions WHERE request_id = ?", [requestId]);
      if (request.length && request[0].id !== prior[0].id) throw new GiftInviteError("该操作标识已用于其他兑换，请核对后重试。", 409);
      await connection.commit();
      return { redeemed: true, replayed: true, credits: String(prior[0].credits), balance: await readBalance(userId) };
    }
    const [codes] = await connection.execute<RowDataPacket[]>("SELECT * FROM gift_invite_codes WHERE code_digest = ? FOR UPDATE", [digest(code)]);
    const invite = codes[0];
    if (!invite || invite.status !== "available") throw new GiftInviteError("邀请码无效、已领取或已作废；您的兑换资格未消耗。", 409);
    const before = await balance(connection, userId), amount = creditUnits(String(invite.credits));
    const sourceId = randomUUID(), redemptionId = randomUUID(), now = new Date();
    await connection.execute("INSERT INTO credit_sources (id,user_id,kind,business_type,business_reference,original_credits,available,reserved,paid_rmb,context_snapshot,created_at) VALUES (?,?,'gift','invite_redemption',?,?,?,0,NULL,?,?)", [sourceId, userId, invite.id, creditText(amount), creditText(amount), JSON.stringify({ inviteId: invite.id }), now]);
    const after = await balance(connection, userId);
    await connection.execute("INSERT INTO credit_entries (id,user_id,account_email,actor_id,actor_email,request_id,business_type,reason,amount,source_kind,balance_before,balance_after,allocations,context_snapshot,created_at) VALUES (?,?,?,?,?,?, 'invite_redemption', ?,?,'gift',?,?,?, ?,?)", [redemptionId, userId, user.email, userId, user.email, requestId, "兑换赠送邀请码", creditText(amount), JSON.stringify(before), JSON.stringify(after), JSON.stringify([{ sourceId, amount: creditText(amount) }]), JSON.stringify({ inviteId: invite.id }), now]);
    await connection.execute("INSERT INTO gift_invite_redemptions (id,code_id,user_id,request_id,credits,created_at) VALUES (?,?,?,?,?,?)", [redemptionId, invite.id, userId, requestId, creditText(amount), now]);
    await connection.execute("UPDATE gift_invite_codes SET status = 'redeemed', redeemed_by = ?, redeemed_at = ? WHERE id = ? AND status = 'available'", [userId, now, invite.id]);
    await connection.commit();
    return { redeemed: true, replayed: false, credits: creditText(amount), balance: after };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
async function readBalance(userId: string) {
  const connection = await getMysqlPool().getConnection();
  try { return await balance(connection, userId); }
  finally { connection.release(); }
}

export async function seedInitialGiftInvites(actorId: string, reason: string) {
  if (!reason.trim() || reason.trim().length > 500) throw new GiftInviteError("请填写初始化原因（最多 500 个字符）。");
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    await assertAdmin(connection, actorId);
    const [batches] = await connection.execute<RowDataPacket[]>("SELECT batch_id FROM gift_invite_batches WHERE batch_id = ? FOR UPDATE", [BATCH_ID]);
    if (batches.length) throw new GiftInviteError("首批邀请码已初始化，不能重复生成。", 409);
    const now = new Date(), codes = Array.from({ length: 100 }, () => codeValue());
    await connection.execute("INSERT INTO gift_invite_batches (batch_id,created_at,created_by,code_count) VALUES (?,?,?,100)", [BATCH_ID, now, actorId]);
    for (const code of codes) await connection.execute("INSERT INTO gift_invite_codes (id,batch_id,code_digest,credits,created_at) VALUES (?,?,?,?,?)", [randomUUID(), BATCH_ID, digest(code), GIFT_AMOUNT, now]);
    await connection.execute("INSERT INTO gift_invite_admin_actions (id,actor_id,action,batch_id,reason,created_at) VALUES (?,?,'seed',?,?,?)", [randomUUID(), actorId, BATCH_ID, reason.trim(), now]);
    await connection.commit();
    return { batchId: BATCH_ID, codes };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function listGiftInvites(actorId: string) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction(); await assertAdmin(connection, actorId);
    const [batches] = await connection.execute<RowDataPacket[]>("SELECT batch_id AS id, code_count AS codeCount, created_at AS createdAt FROM gift_invite_batches ORDER BY created_at");
    const [codes] = await connection.execute<RowDataPacket[]>("SELECT c.id,c.status,c.credits,c.created_at AS createdAt,c.redeemed_at AS redeemedAt,u.email AS redeemedEmail,u.id AS redeemedUserId FROM gift_invite_codes c LEFT JOIN users u ON u.id = c.redeemed_by ORDER BY c.created_at,c.id");
    const [actions] = await connection.execute<RowDataPacket[]>("SELECT a.id,a.action,a.reason,a.created_at AS createdAt,u.email AS actorEmail FROM gift_invite_admin_actions a JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 100");
    await connection.commit();
    return { batches, codes, actions };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function voidGiftInvite(actorId: string, codeId: string, reason: string) {
  if (!reason.trim() || reason.trim().length > 500) throw new GiftInviteError("作废原因应为 1 至 500 个字符。");
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction(); await assertAdmin(connection, actorId);
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT status FROM gift_invite_codes WHERE id = ? FOR UPDATE", [codeId]);
    if (!rows.length) throw new GiftInviteError("邀请码不存在。", 404);
    if (rows[0].status !== "available") throw new GiftInviteError("只有未领取的邀请码可以作废。", 409);
    const now = new Date();
    await connection.execute("UPDATE gift_invite_codes SET status='void',voided_by=?,voided_at=? WHERE id=?", [actorId, now, codeId]);
    await connection.execute("INSERT INTO gift_invite_admin_actions (id,actor_id,action,code_id,reason,created_at) VALUES (?,?,'void',?,?,?)", [randomUUID(), actorId, codeId, reason.trim(), now]);
    await connection.commit();
    return { id: codeId, status: "void" as const, voidedAt: now.toISOString() };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
