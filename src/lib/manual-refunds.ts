import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getMysqlPool } from "@/lib/mysql";
import { isMysqlId } from "@/lib/identifiers";
import { isDesignatedAdmin } from "@/lib/account-controls";
import { lockCreditUsers, readCreditBalance } from "@/lib/credits-ledger";
import { CreditError, creditText, creditUnits, CREDIT_SCALE } from "@/lib/credit-values";
import { refundMoney, refundReason, parseRefundAction, type ManualRefund, type ManualRefundInput, type RefundAction, type RefundSource } from "@/lib/manual-refund-values";

import { refundView } from "@/lib/manual-refund-query";
export { listManualRefunds } from "@/lib/manual-refund-query";

export class RefundConflict extends CreditError {
  constructor(message: string, public existing?: ManualRefund) { super(message, 409); }
}
export function parseManualRefund(body: unknown): ManualRefundInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CreditError("请求格式不正确。");
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !["accountId", "rechargeEntryId", "requestId", "refundRmb", "reason"].includes(key))) throw new CreditError("退款仅接受原充值、账号、金额、操作 ID 和说明。");
  if (typeof value.accountId !== "string" || !isMysqlId(value.accountId) || typeof value.rechargeEntryId !== "string" || !isMysqlId(value.rechargeEntryId)) throw new CreditError("请指定有效的账号与原充值流水 ID。");
  if (typeof value.requestId !== "string" || !/^[A-Za-z0-9_-]{16,160}$/.test(value.requestId)) throw new CreditError("缺少有效操作 ID。");
  return { accountId: value.accountId, rechargeEntryId: value.rechargeEntryId, requestId: value.requestId, refundRmb: creditText(creditUnits(refundMoney(value.refundRmb))), reason: refundReason(value.reason) };
}
async function requireLockedAdmin(connection: PoolConnection, actorId: string, accountId: string) {
  const users = await lockCreditUsers(connection, [actorId, accountId]);
  const actor = users.find(row => row.id === actorId), target = users.find(row => row.id === accountId);
  if (!actor || actor.account_status !== "active" || !isDesignatedAdmin(actor.email)) throw new CreditError("无权访问管理功能。", 403);
  if (!target) throw new CreditError("账号不存在。", 404);
  return { actor, target };
}
// 所有阶段只追加审计，原充值与历史消费永不改写。退款锁定与模型冻结分别记录。
async function appendRefundEntry(connection: PoolConnection, refund: ManualRefund, actor: RowDataPacket, phase: "hold" | "reference" | "transfer" | "complete" | "release", reason: string, before: Awaited<ReturnType<typeof readCreditBalance>>, requestId=refund.id+":"+phase) {
  const after = await readCreditBalance(connection, refund.accountId);
  await connection.execute("INSERT INTO credit_entries (id,user_id,account_email,actor_id,actor_email,request_id,business_type,reason,amount,source_kind,balance_before,balance_after,allocations,context_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?,'purchased',?,?,?,?,?)", [randomUUID(),refund.accountId,refund.accountEmail,actor.id,actor.email,requestId,phase === "complete" ? "manual_refund" : "manual_refund_"+phase,reason,phase === "complete" ? "-"+refund.credits : "0",JSON.stringify(before),JSON.stringify(after),JSON.stringify([{sourceId:refund.sourceId,amount:phase === "reference" ? "0" : phase === "complete" ? "-"+refund.credits : refund.credits}]),JSON.stringify({refundId:refund.id,rechargeEntryId:refund.rechargeEntryId,refundRmb:refund.refundRmb,refundCredits:refund.credits,transferStatus:refund.transferStatus,accountingStatus:refund.accountingStatus,externalReference:refund.externalReference}),new Date()]);
}
const sourceSelect = "SELECT s.*,e.id AS recharge_entry_id,e.context_snapshot->>'$.receiptReference' AS receipt_reference,COALESCE((SELECT SUM(r.refund_rmb) FROM credit_refunds r WHERE r.source_id=s.id AND r.accounting_status<>'released'),0) AS committed_rmb FROM credit_sources s JOIN credit_entries e ON e.id=s.context_snapshot->>'$.entryId' AND e.user_id=s.user_id AND e.business_type='manual_recharge' WHERE s.user_id=? AND s.kind='purchased' AND s.business_type='manual_recharge'";
function sourceView(row: RowDataPacket): RefundSource {
  const paid = creditUnits(row.paid_rmb), remaining = paid-creditUnits(row.committed_rmb);
  // 只退完整的分；残余积分可能含八位小数，向下取整，绝不四舍五入多退。
  const fromAvailable = creditUnits(row.available)/BigInt(1000), cap = fromAvailable < remaining ? fromAvailable : remaining;
  const refundable = cap > BigInt(0) ? cap/(CREDIT_SCALE/BigInt(100))*(CREDIT_SCALE/BigInt(100)) : BigInt(0);
  return { sourceId: row.id, rechargeEntryId: row.recharge_entry_id, receiptReference: row.receipt_reference, originalPaidRmb: creditText(paid), originalCredits: creditText(creditUnits(row.original_credits)), available: creditText(creditUnits(row.available)), reserved: creditText(creditUnits(row.reserved)), refundHeld: creditText(creditUnits(row.refund_held)), remainingPaidRmb: creditText(remaining), refundableRmb: creditText(refundable) };
}
export async function initiateManualRefund(actorId: string, input: ManualRefundInput) {
  const operation = parseManualRefund(input), credits = creditText(creditUnits(operation.refundRmb)*BigInt(1000));
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const {actor,target} = await requireLockedAdmin(connection,actorId,operation.accountId);
    // 退款发起与别名共用管理员全局审计身份，终态后重试仍定位原笔。
    const [saved] = await connection.execute<RowDataPacket[]>("SELECT business_type,context_snapshot->>'$.refundId' AS refund_id FROM credit_entries WHERE actor_id=? AND request_id=? FOR UPDATE",[actorId,operation.requestId]);
    const matches = (value: ManualRefund) => value.accountId===operation.accountId && value.rechargeEntryId===operation.rechargeEntryId && value.refundRmb===operation.refundRmb && value.reason===operation.reason;
    if (saved.length) {
      if (!["manual_refund_hold","manual_refund_reference"].includes(saved[0].business_type)) throw new RefundConflict("此操作 ID 已用于其他业务，请核对原流水。");
      const [rows]=await connection.execute<RowDataPacket[]>("SELECT * FROM credit_refunds WHERE id=? FOR UPDATE",[saved[0].refund_id]);
      if (!rows.length) throw new CreditError("原退款关联暂时不可用，请保留操作 ID 并核对原记录。",503);
      const refund=refundView(rows[0]);
      if (!matches(refund)) throw new RefundConflict("此操作 ID 已用于其他退款，请核对原记录。",refund);
      await connection.commit(); return {refund,replayed:true};
    }
    // 在账号锁之后建立读取快照，原来源与模型消费、预留、恢复和其他退款互斥。
    const [sources] = await connection.execute<RowDataPacket[]>(sourceSelect+" AND e.id=?",[operation.accountId,operation.rechargeEntryId]);
    if (sources.length!==1) throw new CreditError("未找到该账号的原实付购买来源；赠送积分不能退款。",404);
    const source=sources[0];
    const [active] = await connection.execute<RowDataPacket[]>("SELECT * FROM credit_refunds WHERE source_id=? AND accounting_status='held' FOR UPDATE",[source.id]);
    if (active.length) {
      const refund=refundView(active[0]);
      if (!matches(refund)) throw new RefundConflict("此充值已有待核实或待记账退款；先处理原记录，不能再次转账。",refund);
      const before=await readCreditBalance(connection,operation.accountId);
      await appendRefundEntry(connection,refund,actor,"reference",operation.reason,before,operation.requestId);
      await connection.commit();return {refund,replayed:true};
    }
    if (creditUnits(operation.refundRmb)>creditUnits(sourceView(source).refundableRmb)) throw new CreditError("退款超过此原充值剩余可退金额；已消费、模型预留和退款锁定部分不能再退。",409);
    const before=await readCreditBalance(connection,operation.accountId),now=new Date(),id=randomUUID();
    await connection.execute("UPDATE credit_sources SET available=available-?,refund_held=refund_held+? WHERE id=?",[credits,credits,source.id]);
    await connection.execute("INSERT INTO credit_refunds (id,user_id,account_email,recharge_entry_id,source_id,actor_id,actor_email,request_id,refund_rmb,credits,reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",[id,operation.accountId,target.email,operation.rechargeEntryId,source.id,actorId,actor.email,operation.requestId,operation.refundRmb,credits,operation.reason,now,now]);
    const [created]=await connection.execute<RowDataPacket[]>("SELECT * FROM credit_refunds WHERE id=?",[id]);
    const refund=refundView(created[0]);
    await appendRefundEntry(connection,refund,actor,"hold",operation.reason,before,operation.requestId);
    await connection.commit();return {refund,replayed:false};
  } catch(error) {await connection.rollback();throw error;} finally {connection.release();}
}

/** 外部事实先持久保存；后续记账失败不能回滚已确认的外部退款，也不能再次转账。 */
async function recordRefundAction(actorId: string, id: string, action: RefundAction) {
  if (!isMysqlId(id)) throw new CreditError("退款记录不存在。",404);
  const connection=await getMysqlPool().getConnection();
  try {
    // 此查询仅定位账号，事务中的数据必须在账号锁之后重新锁定读取。
    const [owners]=await connection.execute<RowDataPacket[]>("SELECT user_id FROM credit_refunds WHERE id=?",[id]);
    if (!owners.length) throw new CreditError("退款记录不存在。",404);
    await connection.beginTransaction();
    const {actor}=await requireLockedAdmin(connection,actorId,owners[0].user_id);
    const [rows]=await connection.execute<RowDataPacket[]>("SELECT * FROM credit_refunds WHERE id=? FOR UPDATE",[id]);
    const refund=refundView(rows[0]);
    if (action.action==="complete") {
      if (refund.accountingStatus==="completed") {await connection.commit();return {refund,replayed:true};}
      if (refund.transferStatus!=="succeeded" || refund.accountingStatus!=="held") throw new RefundConflict("须先核实并登记外部退款成功；结果不明时继续锁定，不能直接扣账。",refund);
    } else if (refund.transferStatus!=="unverified") {
      const expected=action.action==="confirm-transfer" ? "succeeded" : "failed";
      if (refund.transferStatus!==expected || refund.externalReference!==(action.externalReference??null) || refund.transferReason!==action.reason) throw new RefundConflict("原转账结果已记录且不可改写；请核对原退款，不要再次转账。",refund);
      await connection.commit();return {refund,replayed:true};
    }
    const before=await readCreditBalance(connection,refund.accountId);
    if (action.action==="confirm-transfer") {
      if (!action.externalReference) throw new CreditError("缺少已核实的外部参考号。");
      await connection.execute("UPDATE credit_refunds SET transfer_status='succeeded',external_reference=?,transfer_reason=?,updated_at=? WHERE id=?",[action.externalReference,action.reason,new Date(),id]);
    } else {
      const [sources]=await connection.execute<RowDataPacket[]>("SELECT refund_held FROM credit_sources WHERE id=? AND user_id=? FOR UPDATE",[refund.sourceId,refund.accountId]);
      if (!sources.length || creditUnits(sources[0].refund_held)<creditUnits(refund.credits)) throw new CreditError("退款锁定来源不一致，请保留原记录并联系管理员核查。",503);
      if (action.action==="mark-failed") {
        await connection.execute("UPDATE credit_sources SET refund_held=refund_held-?,available=available+? WHERE id=?",[refund.credits,refund.credits,refund.sourceId]);
        await connection.execute("UPDATE credit_refunds SET transfer_status='failed',accounting_status='released',external_reference=?,transfer_reason=?,updated_at=? WHERE id=?",[action.externalReference??null,action.reason,new Date(),id]);
      } else {
        await connection.execute("UPDATE credit_sources SET refund_held=refund_held-? WHERE id=?",[refund.credits,refund.sourceId]);
        await connection.execute("UPDATE credit_refunds SET accounting_status='completed',updated_at=? WHERE id=?",[new Date(),id]);
      }
    }
    const [updated]=await connection.execute<RowDataPacket[]>("SELECT * FROM credit_refunds WHERE id=?",[id]);
    const result=refundView(updated[0]);
    await appendRefundEntry(connection,result,actor,action.action==="confirm-transfer"?"transfer":action.action==="mark-failed"?"release":"complete",action.reason,before);
    await connection.commit();return {refund:result,replayed:false};
  } catch(error) {
    await connection.rollback();
    if ((error as {code?:string}).code==="ER_DUP_ENTRY") throw new RefundConflict("外部参考号已被登记，请核对原交易，禁止再次转账。");
    throw error;
  } finally {connection.release();}
}
export async function processManualRefund(actorId: string,id: string,body: unknown) {
  const action=parseRefundAction(body);
  const result=await recordRefundAction(actorId,id,action);
  if (action.action!=="confirm-transfer" || result.refund.accountingStatus!=="held") return result;
  try {return await recordRefundAction(actorId,id,{action:"complete",reason:"外部退款已核实，完成对应购买积分扣账。"});}
  catch {
    // 外部结果已提交，内账重试失败或提交响应丢失时，只报告待查询，绝不提示再次转账。
    return {...result,warning:"外部退款已确认，内部记账结果待核实。积分持续锁定；请刷新查询，必要时仅重试内部记账，勿再次转账。"};
  }
}

export function refundFilters(params: URLSearchParams) {
  if ([...params.keys()].some(key=>!["q","page"].includes(key))) throw new CreditError("退款查询仅支持筛选和分页。");
  const q=(params.get("q")??"").trim(),page=Number(params.get("page")??"1");
  if (q.length>320 || !Number.isSafeInteger(page) || page<1 || page>1000000) throw new CreditError("查询条件或页码不正确。");
  return {q,page};
}
export async function listRefundSources(accountId: string,page=1) {
  if (!isMysqlId(accountId)) throw new CreditError("账号不存在。",404);
  const connection=await getMysqlPool().getConnection();
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const [counts]=await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM credit_sources WHERE user_id=? AND kind='purchased' AND business_type='manual_recharge'",[accountId]);
    const total=Number(counts[0].total),pageSize=20,currentPage=Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
    const [rows]=await connection.query<RowDataPacket[]>(sourceSelect+" ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?",[accountId,pageSize,(currentPage-1)*pageSize]);
    await connection.commit();return {sources:rows.map(sourceView),total,page:currentPage,pageSize};
  } catch(error) {await connection.rollback();throw error;} finally {connection.release();}
}
