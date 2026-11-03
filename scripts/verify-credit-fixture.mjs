// 已知来源样本只在随机隔离库建立；不声称本票已完成实际充值或预留流程。
import { randomUUID } from "node:crypto";
export async function seedProtectedCredits(admin, database, env) {
  if (!/^v141_replay_[a-f0-9]{16}$/.test(database) || !env.V144_LEGACY_EMAIL) throw Error("拒绝向非隔离库写入资金夹具");
  await admin.query("USE ??", [database]);
  const [users] = await admin.execute("SELECT id, email FROM users WHERE email IN (?, ?)", [env.V144_LEGACY_EMAIL, env.V144_ADMIN_EMAIL]);
  const user = users.find(row => row.email === env.V144_LEGACY_EMAIL), actor = users.find(row => row.email === env.V144_ADMIN_EMAIL);
  if (!user || !actor) throw Error("缺少隔离账号");
  const [existing] = await admin.execute("SELECT id FROM credit_sources WHERE user_id = ?", [user.id]);
  if (existing.length) throw Error("拒绝重复构造夹具");
  const zero = { gift: { available: "0", reserved: "0" }, purchased: { available: "0", reserved: "0" } };
  const gifted = { gift: { available: "3.25", reserved: "6.75" }, purchased: { available: "0", reserved: "0" } };
  const protectedBalance = { gift: { available: "3.25", reserved: "6.75" }, purchased: { available: "70.125", reserved: "30" } };
  const sourceIds = [], entryIds = [], now = new Date();
  await admin.beginTransaction();
  try {
    for (const item of [
      { kind: "gift", original: "10", available: "3.25", reserved: "6.75", paid: null, before: zero, after: gifted },
      { kind: "purchased", original: "100.125", available: "70.125", reserved: "30", paid: "0.100125", before: gifted, after: protectedBalance },
    ]) {
      const source = randomUUID(), entry = randomUUID(); sourceIds.push(source); entryIds.push(entry);
      const context = { projectId: env.V144_LEGACY_PROJECT_ID, projectName: "升级前项目", receiptReference: item.kind === "purchased" ? "isolated-known-payment" : null, originalPaidRmb: item.paid };
      await admin.execute("INSERT INTO credit_sources (id,user_id,kind,business_type,business_reference,original_credits,available,reserved,paid_rmb,context_snapshot,created_at) VALUES (?,?,?,'fixture_opening',?,?,?,?,?,?,?)", [source,user.id,item.kind,entry,item.original,item.available,item.reserved,item.paid,JSON.stringify(context),now]);
      await admin.execute("INSERT INTO credit_entries (id,user_id,account_email,actor_id,actor_email,request_id,business_type,reason,amount,source_kind,balance_before,balance_after,allocations,context_snapshot,created_at) VALUES (?,?,?,?,?,?,'fixture_opening','已知历史来源与预留隔离样本',?,?,?,?,?,?,?)", [entry,user.id,user.email,actor.id,actor.email,randomUUID(),item.original,item.kind,JSON.stringify(item.before),JSON.stringify(item.after),JSON.stringify([{ sourceId: source, amount: item.original }]),JSON.stringify(context),now]);
    }
    await admin.commit();
    return { accountId: user.id, sourceIds, entryIds };
  } catch (error) { await admin.rollback(); throw error; }
}

/** 仅用于 #07：为升级前隔离账号提供可核对的购买来源；不冒充实际充值。 */
export async function seedConversationPurchase(admin, database, env) {
  if (!/^v141_replay_[a-f0-9]{16}$/.test(database) || !env.V144_LEGACY_EMAIL) throw Error("拒绝在非隔离库构造购买来源");
  await admin.query("USE ??", [database]);
  await admin.beginTransaction();
  try {
    const [users] = await admin.execute("SELECT id,email FROM users WHERE email IN (?,?) ORDER BY id FOR UPDATE", [env.V144_LEGACY_EMAIL,env.V144_ADMIN_EMAIL]);
    const user = users.find(row => row.email === env.V144_LEGACY_EMAIL), actor = users.find(row => row.email === env.V144_ADMIN_EMAIL);
    if (!user || !actor) throw Error("缺少隔离样本账号");
    const [rows] = await admin.execute("SELECT id FROM credit_sources WHERE user_id=?", [user.id]);
    if (rows.length) throw Error("拒绝覆盖已存在的资金来源");
    const sourceId = randomUUID(), entryId = randomUUID(), now = new Date();
    const context = { fixture:true, receiptReference:"isolated-purchase-07", originalPaidRmb:"2" };
    const before = { gift:{available:"0",reserved:"0"}, purchased:{available:"0",reserved:"0"} };
    const after = { ...before, purchased:{available:"2000",reserved:"0"} };
    await admin.execute("INSERT INTO credit_sources (id,user_id,kind,business_type,business_reference,original_credits,available,reserved,paid_rmb,context_snapshot,created_at) VALUES (?,?,'purchased','fixture_opening',?,'2000','2000',0,'2',?,?)", [sourceId,user.id,entryId,JSON.stringify(context),now]);
    await admin.execute("INSERT INTO credit_entries (id,user_id,account_email,actor_id,actor_email,request_id,business_type,reason,amount,source_kind,balance_before,balance_after,allocations,context_snapshot,created_at) VALUES (?,?,?,?,?,?,'fixture_opening','购买来源隔离样本','2000','purchased',?,?,?,?,?)", [entryId,user.id,user.email,actor.id,actor.email,randomUUID(),JSON.stringify(before),JSON.stringify(after),JSON.stringify([{sourceId,amount:"2000"}]),JSON.stringify(context),now]);
    await admin.commit();
    return { accountId:user.id,sourceId,entryId };
  } catch (error) { await admin.rollback(); throw error; }
}
