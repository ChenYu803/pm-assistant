import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getMysqlPool } from "@/lib/mysql";
import { lockCreditUsers, readCreditBalance } from "@/lib/credits-ledger";
import { CreditError, creditText, creditUnits, type CreditCallView } from "@/lib/credit-values";
import type { ConversationBudget } from "@/lib/conversation-credit-budget";

export type CreditCallInput = { requestKey: string; requestDigest: string; messageId: string; sessionId: string; context: Record<string, unknown> };
type Allocation = { sourceId: string; kind: "gift" | "purchased"; amount: string };
function view(row: RowDataPacket): CreditCallView {
  return { id: row.id, messageId: row.message_id, state: row.state, reserved: creditText(creditUnits(row.reserved)), consumed: row.consumed === null ? null : creditText(creditUnits(row.consumed)), reason: row.reason };
}
export async function findCreditCall(userId: string, requestKey: string) {
  const [rows] = await getMysqlPool().execute<RowDataPacket[]>("SELECT * FROM conversation_credit_calls WHERE user_id=? AND request_key=?", [userId, requestKey]);
  return rows[0] ? { ...view(rows[0]), requestDigest: rows[0].request_digest as string, sessionId: rows[0].session_id as string } : null;
}
export async function messageCreditCalls(sessionId: string) {
  const [rows] = await getMysqlPool().execute<RowDataPacket[]>("SELECT * FROM conversation_credit_calls WHERE session_id=? ORDER BY created_at,id", [sessionId]);
  return new Map(rows.map(row => [row.message_id as string, view(row)]));
}

/** 调用记录与预留共用事务；调用方必须在其提交之后才能访问供应商。 */
export async function reserveConversationCredits(connection: PoolConnection, userId: string, id: string, input: CreditCallInput, budget: ConversationBudget) {
  const [user] = await lockCreditUsers(connection, [userId]);
  if (!user || user.account_status !== "active") throw new CreditError("账号不可用，请重新登录或联系管理员。", 403);
  const [existing] = await connection.execute<RowDataPacket[]>("SELECT id FROM conversation_credit_calls WHERE user_id=? AND request_key=? FOR UPDATE", [userId, input.requestKey]);
  if (existing.length) throw new CreditError("此生成请求已处理，请刷新会话查看结果。", 409);
  const [active] = await connection.execute<RowDataPacket[]>("SELECT id FROM conversation_credit_calls WHERE user_id=? AND session_id=? AND state='reserved' FOR UPDATE", [userId, input.sessionId]);
  if (active.length) throw new CreditError("当前会话已有未结束的生成，请稍后重试。", 409);
  const before = await readCreditBalance(connection, userId);
  let remaining = creditUnits(budget.reserved);
  if (creditUnits(before.gift.available) + creditUnits(before.purchased.available) < remaining) throw new CreditError("可用积分不足以支持本次生成，输入已保留。请到个人中心兑换邀请码或联系管理员充值。", 402);
  const [sources] = await connection.execute<RowDataPacket[]>("SELECT id,kind,available FROM credit_sources WHERE user_id=? AND available>0 ORDER BY kind,created_at,id FOR UPDATE", [userId]);
  const allocations: Allocation[] = [];
  for (const source of sources) {
    if (remaining === BigInt(0)) break;
    const available = creditUnits(source.available), amount = available < remaining ? available : remaining;
    await connection.execute("UPDATE credit_sources SET available=available-?,reserved=reserved+? WHERE id=?", [creditText(amount),creditText(amount),source.id]);
    allocations.push({ sourceId: source.id, kind: source.kind, amount: creditText(amount) });
    remaining -= amount;
  }
  if (remaining !== BigInt(0)) throw new CreditError("积分来源不一致，请联系管理员。", 503);
  await connection.execute("INSERT INTO conversation_credit_calls (id,user_id,request_key,request_digest,message_id,session_id,state,reserved,allocations,budget_json,context_snapshot,created_at) VALUES (?,?,?,?,?,?,'reserved',?,?,?,?,?)", [id,userId,input.requestKey,input.requestDigest,input.messageId,input.sessionId,budget.reserved,JSON.stringify(allocations),JSON.stringify(budget),JSON.stringify(input.context),new Date()]);
  await appendCallEntries(connection,{id,user,phase:"reserve",reason:"生成前预留",before,allocations,context:input.context});
}

type EntryInput = { id: string; user: RowDataPacket; phase: "reserve" | "settle" | "release"; reason: string; before: Awaited<ReturnType<typeof readCreditBalance>>; allocations: Allocation[]; context: Record<string, unknown> };
async function appendCallEntries(connection: PoolConnection, input: EntryInput) {
  let before = input.before;
  for (const kind of ["gift", "purchased"] as const) {
    const parts = input.allocations.filter(part => part.kind === kind);
    if (!parts.length) continue;
    const amount = parts.reduce((total, part) => total + creditUnits(part.amount), BigInt(0));
    const available = creditUnits(before[kind].available), reserved = creditUnits(before[kind].reserved);
    const after = { ...before, [kind]: {
      available: creditText(available + (input.phase === "reserve" ? -amount : input.phase === "release" ? amount : BigInt(0))),
      reserved: creditText(reserved + (input.phase === "reserve" ? amount : -amount)),
    } };
    await connection.execute("INSERT INTO credit_entries (id,user_id,account_email,actor_id,actor_email,request_id,business_type,reason,amount,source_kind,balance_before,balance_after,allocations,context_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [randomUUID(),input.user.id,input.user.email,input.user.id,input.user.email,input.id+":"+input.phase+":"+kind,"model_"+input.phase,input.reason,creditText(input.phase === "settle" ? -amount : BigInt(0)),kind,JSON.stringify(before),JSON.stringify(after),JSON.stringify(parts),JSON.stringify({...input.context,callId:input.id}),new Date()]);
    before = after;
  }
  return before;
}

/** 调用方已有事务时，必须先锁账号，再锁项目等业务对象。 */
export async function settleConversationCredits(id: string, provided?: PoolConnection) {
  const connection = provided ?? await getMysqlPool().getConnection();
  try {
    // 独立事务必须在账号锁之后才建立一致性读快照。
    const [owners] = await connection.execute<RowDataPacket[]>("SELECT user_id FROM conversation_credit_calls WHERE id=?",[id]);
    if (!owners.length) return;
    if (!provided) await connection.beginTransaction();
    const [user] = await lockCreditUsers(connection,[owners[0].user_id]);
    if (!user) throw new CreditError("调用账号缺失，请联系管理员。",503);
    const [calls] = await connection.execute<RowDataPacket[]>("SELECT * FROM conversation_credit_calls WHERE id=? FOR UPDATE",[id]);
    const call = calls[0];
    if (["settled","released"].includes(call.state)) { if (!provided) await connection.commit(); return; }
    const [models] = await connection.execute<RowDataPacket[]>("SELECT * FROM model_requests WHERE id=? FOR UPDATE",[id]);
    const model = models[0];
    if (!model || ["running","processing"].includes(model.status)) { if (!provided) await connection.commit(); return; }
    const free = Boolean(model.website_borne) || ["failed","interrupted"].includes(model.status);
    const confirmed = model.usage_status === "reliable" && model.cost_cny !== null;
    const consumed = free ? BigInt(0) : confirmed ? creditUnits(model.cost_cny)*BigInt(2000) : null;
    const budget = call.budget_json as ConversationBudget;
    const outside = !free && consumed !== null && (consumed > creditUnits(call.reserved) || (model.usage_json && (model.usage_json.prompt_tokens > budget.inputTokenBound || model.usage_json.completion_tokens > budget.maxOutputTokens)));
    if (consumed === null || outside) {
      await connection.execute("UPDATE conversation_credit_calls SET state='pending',pending_since=COALESCE(pending_since,?),reason=? WHERE id=?", [new Date(),outside?"budget_exceeded":model.status === "stopped"?"stopped_usage_unconfirmed":"usage_or_price_unconfirmed",id]);
      if (!provided) await connection.commit(); return;
    }
    const allocations = call.allocations as Allocation[], spent: Allocation[] = [], released: Allocation[] = [];
    const before = await readCreditBalance(connection,user.id);
    let remaining = consumed;
    for (const part of allocations) {
      const held = creditUnits(part.amount), used = remaining < held ? remaining : held, refund = held-used;
      await connection.execute("UPDATE credit_sources SET reserved=reserved-?,available=available+? WHERE id=? AND user_id=?", [part.amount,creditText(refund),part.sourceId,user.id]);
      if (used > BigInt(0)) spent.push({...part,amount:creditText(used)});
      if (refund > BigInt(0)) released.push({...part,amount:creditText(refund)});
      remaining -= used;
    }
    const afterConsumption = await appendCallEntries(connection,{id,user,phase:"settle",reason:model.status === "stopped"?"主动停止，按可靠用量结算":"按可靠用量结算",before,allocations:spent,context:call.context_snapshot});
    await appendCallEntries(connection,{id,user,phase:"release",reason:free?"生成故障免单，释放预留":"释放未用预留",before:afterConsumption,allocations:released,context:call.context_snapshot});
    await connection.execute("UPDATE conversation_credit_calls SET state=?,consumed=?,settled_at=?,reason=? WHERE id=?", [free?"released":"settled",creditText(consumed),new Date(),free?"website_borne":model.status === "stopped"?"stopped_confirmed":"confirmed",id]);
    if (!provided) await connection.commit();
  } catch (error) { if (!provided) await connection.rollback(); throw error; }
  finally { if (!provided) connection.release(); }
}
