import { readRefunds } from "@/lib/manual-refund-query";
import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getMysqlPool } from "@/lib/mysql";
import { isMysqlId } from "@/lib/identifiers";
import { isDesignatedAdmin } from "@/lib/account-controls";
import { CreditError, creditText, creditUnits, type CreditBalance, type CreditEntry } from "@/lib/credit-values";

/** 所有后续账本写入先按同一顺序锁定账号，再锁来源，避免跨功能竞争。 */
export async function lockCreditUsers(connection: PoolConnection, ids: string[]) {
  const users: RowDataPacket[] = [];
  for (const id of [...new Set(ids)].sort()) {
    const [rows] = await connection.execute<RowDataPacket[]>("SELECT id, email, account_status FROM users WHERE id = ? FOR UPDATE", [id]);
    users.push(...rows);
  }
  return users;
}
export async function readCreditBalance(connection: PoolConnection, userId: string): Promise<CreditBalance> {
  const [rows] = await connection.execute<RowDataPacket[]>("SELECT kind, SUM(available) AS available, SUM(reserved) AS reserved FROM credit_sources WHERE user_id = ? GROUP BY kind", [userId]);
  const value: CreditBalance = { gift: { available: "0", reserved: "0" }, purchased: { available: "0", reserved: "0" } };
  for (const row of rows) value[row.kind as keyof CreditBalance] = { available: creditText(creditUnits(row.available)), reserved: creditText(creditUnits(row.reserved)) };
  return value;
}
export function creditEntry(row: RowDataPacket): CreditEntry {
  return { id: row.id, accountId: row.user_id, accountEmail: row.account_email, actorId: row.actor_id, actorEmail: row.actor_email, requestId: row.request_id, businessType: row.business_type, reason: row.reason, amount: creditText(creditUnits(row.amount)), sourceKind: row.source_kind, before: row.balance_before, after: row.balance_after, allocations: row.allocations, context: row.context_snapshot, createdAt: new Date(row.created_at).toISOString() };
}
export async function readCreditStatement(userId: string, page = 1) {
  if (!isMysqlId(userId)) throw new CreditError("账号不存在。", 404);
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const [users] = await connection.execute<RowDataPacket[]>("SELECT id FROM users WHERE id = ?", [userId]);
    if (!users.length) throw new CreditError("账号不存在。", 404);
    const current = await readCreditBalance(connection, userId);
    const [counts] = await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM credit_entries WHERE user_id = ?", [userId]);
    const total = Number(counts[0].total), pageSize = 20, currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const [rows] = await connection.query<RowDataPacket[]>("SELECT * FROM credit_entries WHERE user_id = ? ORDER BY sequence DESC LIMIT ? OFFSET ?", [userId, pageSize, (currentPage - 1) * pageSize]);
    const [pending] = await connection.execute<RowDataPacket[]>("SELECT id,message_id,state,reserved,consumed,reason FROM conversation_credit_calls WHERE user_id=? AND state IN ('reserved','pending') ORDER BY created_at,id",[userId]);
    const pendingCalls = pending.map(row => ({id:row.id,messageId:row.message_id,state:row.state,reserved:creditText(creditUnits(row.reserved)),consumed:null,reason:row.reason}));
    const refunds=await readRefunds(connection,{accountId:userId});
    const [held]=await connection.execute<RowDataPacket[]>("SELECT COALESCE(SUM(refund_held),0) AS held FROM credit_sources WHERE user_id=?",[userId]);
    await connection.commit();
    return { accountId: userId, balance: current, pendingCalls, refunds:refunds.refunds,refundTotal:refunds.total,refundHeld:creditText(creditUnits(held[0].held)), entries: rows.map(creditEntry), total, page: currentPage, pageSize };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export type CreditAdjustment = { requestId: string; type: "grant" | "compensation" | "correction"; amount: string; reason: string };
export function parseCreditAdjustment(body: unknown): CreditAdjustment {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CreditError("请求格式不正确。");
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !["requestId", "type", "amount", "reason"].includes(key))) throw new CreditError("调整仅支持赠送积分，购买积分请使用充值或退款流程。");
  if (typeof value.requestId !== "string" || !/^[A-Za-z0-9_-]{16,160}$/.test(value.requestId)) throw new CreditError("缺少有效操作标识，请重新发起操作。");
  if (!["grant", "compensation", "correction"].includes(value.type as string)) throw new CreditError("请选择赠送、补偿或赠送余额纠正。");
  if (typeof value.reason !== "string" || !value.reason.trim() || Array.from(value.reason.trim()).length > 500) throw new CreditError("操作原因应为 1 至 500 个字符。");
  const units = creditUnits(value.amount);
  if (units === BigInt("0") || units > BigInt("99999999999999999999") || units < -BigInt("99999999999999999999")) throw new CreditError("单次调整应非零且绝对值小于一万亿积分。");
  if (value.type !== "correction" && units < BigInt("0")) throw new CreditError("赠送和补偿积分必须大于零。");
  return { requestId: value.requestId, type: value.type as CreditAdjustment["type"], amount: creditText(units), reason: value.reason.trim() };
}
export async function adjustCredits(actorId: string, userId: string, input: CreditAdjustment) {
  if (!isMysqlId(userId)) throw new CreditError("账号不存在。", 404);
  const operation = parseCreditAdjustment(input), units = creditUnits(operation.amount);
  const businessType = "admin_" + (operation.type === "compensation" ? "compensation" : operation.type === "correction" ? "correction" : "grant");
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const users = await lockCreditUsers(connection, [actorId, userId]);
    const actor = users.find(user => user.id === actorId), target = users.find(user => user.id === userId);
    if (!actor || actor.account_status !== "active" || !isDesignatedAdmin(actor.email)) throw new CreditError("无权访问管理功能。", 403);
    if (!target) throw new CreditError("账号不存在。", 404);
    const [existing] = await connection.execute<RowDataPacket[]>("SELECT * FROM credit_entries WHERE actor_id = ? AND request_id = ? FOR UPDATE", [actorId, operation.requestId]);
    if (existing.length) {
      const saved = creditEntry(existing[0]);
      if (saved.accountId !== userId || saved.businessType !== businessType || saved.amount !== operation.amount || saved.reason !== operation.reason) throw new CreditError("此操作标识已用于其他内容，请核对原流水后重新发起。", 409);
      await connection.commit(); return { entry: saved, replayed: true };
    }
    const before = await readCreditBalance(connection, userId);
    if (units < BigInt("0") && creditUnits(before.gift.available) < -units) throw new CreditError("可用赠送积分不足，不能扣减预留或购买积分。", 409);
    // 预先检查上限，数据库精度溢出前回滚并给出可纠正反馈。
    if (creditUnits(before.gift.available) + units >= BigInt("10") ** BigInt("28")) throw new CreditError("账号积分超过支持上限。", 409);
    const id = randomUUID(), now = new Date(), allocations: { sourceId: string; amount: string }[] = [];
    if (units > BigInt("0")) {
      const sourceId = randomUUID();
      await connection.execute("INSERT INTO credit_sources (id,user_id,kind,business_type,business_reference,original_credits,available,reserved,paid_rmb,created_at) VALUES (?,?,'gift',?,?,?,?,0,NULL,?)", [sourceId, userId, businessType, id, operation.amount, operation.amount, now]);
      allocations.push({ sourceId, amount: operation.amount });
    } else {
      const [sources] = await connection.execute<RowDataPacket[]>("SELECT id, available FROM credit_sources WHERE user_id = ? AND kind = 'gift' AND available > 0 ORDER BY created_at, id FOR UPDATE", [userId]);
      let remaining = -units;
      for (const source of sources) {
        const available = creditUnits(source.available), used = remaining < available ? remaining : available;
        if (used === BigInt("0")) break;
        await connection.execute("UPDATE credit_sources SET available = available - ? WHERE id = ?", [creditText(used), source.id]);
        allocations.push({ sourceId: source.id, amount: creditText(-used) }); remaining -= used;
      }
      if (remaining !== BigInt("0")) throw new CreditError("积分来源暂不一致，请稍后重试。", 409);
    }
    const after = await readCreditBalance(connection, userId);
    await connection.execute("INSERT INTO credit_entries (id,user_id,account_email,actor_id,actor_email,request_id,business_type,reason,amount,source_kind,balance_before,balance_after,allocations,created_at) VALUES (?,?,?,?,?,?,?,?,?,'gift',?,?,?,?)", [id,userId,target.email,actorId,actor.email,operation.requestId,businessType,operation.reason,operation.amount,JSON.stringify(before),JSON.stringify(after),JSON.stringify(allocations),now]);
    await connection.commit();
    return { entry: { id, accountId: userId, accountEmail: target.email, actorId, actorEmail: actor.email, requestId: operation.requestId, businessType, reason: operation.reason, amount: operation.amount, sourceKind: "gift" as const, before, after, allocations, context: null, createdAt: now.toISOString() }, replayed: false };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
