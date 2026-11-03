import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getMysqlPool } from "@/lib/mysql";
import { isMysqlId } from "@/lib/identifiers";
import { isDesignatedAdmin } from "@/lib/account-controls";
import { creditEntry, lockCreditUsers, readCreditBalance } from "@/lib/credits-ledger";
import { CreditError, creditText, creditUnits, type CreditEntry } from "@/lib/credit-values";

export type ManualRecharge = { accountId:string; requestId:string; paidRmb:string; receiptReference:string; reason:string };
export class RechargeConflict extends CreditError {
  constructor(message:string, public existing:CreditEntry) { super(message,409); }
}
export function parseManualRecharge(body:unknown):ManualRecharge {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CreditError("请求格式不正确。");
  const value = body as Record<string,unknown>;
  if (Object.keys(value).some(key=>!["accountId","requestId","paidRmb","receiptReference","reason"].includes(key))) throw new CreditError("充值仅接受账号、实收金额、交易参考号和业务说明，赠送或补偿请使用积分调整。");
  if (typeof value.accountId !== "string" || !isMysqlId(value.accountId)) throw new CreditError("请指定有效的完整账号 ID。");
  if (typeof value.requestId !== "string" || !/^[A-Za-z0-9_-]{16,160}$/.test(value.requestId)) throw new CreditError("缺少有效操作 ID。");
  // 人民币以分为最小单位，仅接受十进制字符串，不使用浮点数计算金额。
  if (typeof value.paidRmb !== "string" || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value.paidRmb) || creditUnits(value.paidRmb)<=BigInt(0)) throw new CreditError("实收人民币须大于零、最多两位小数，且不超过 999999999.99 元。");
  if (typeof value.receiptReference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.receiptReference.trim())) throw new CreditError("交易参考号须为 1 至 128 位字母、数字或 . _ : -，不得含空格。");
  if (typeof value.reason !== "string" || !value.reason.trim() || Array.from(value.reason.trim()).length>500) throw new CreditError("请填写 1 至 500 个字符的实收核验业务说明。");
  return {accountId:value.accountId, requestId:value.requestId, paidRmb:creditText(creditUnits(value.paidRmb)), receiptReference:value.receiptReference.trim().toUpperCase(), reason:value.reason.trim()};
}
/** 与所有积分写入共用账号锁；来源、实付、余额与审计一次提交或全部回滚。 */
export async function creditManualRecharge(actorId:string,input:ManualRecharge,attempt=0):Promise<{entry:CreditEntry;replayed:boolean}> {
  const operation=parseManualRecharge(input), amount=creditText(creditUnits(operation.paidRmb)*BigInt(1000));
  const connection=await getMysqlPool().getConnection();
  let released=false;
  try {
    await connection.beginTransaction();
    const users=await lockCreditUsers(connection,[actorId,operation.accountId]);
    const actor=users.find(row=>row.id===actorId), target=users.find(row=>row.id===operation.accountId);
    if (!actor || actor.account_status!=="active" || !isDesignatedAdmin(actor.email)) throw new CreditError("无权访问管理功能。",403);
    if (!target) throw new CreditError("账号不存在。",404);
    const [requests]=await connection.execute<RowDataPacket[]>("SELECT * FROM credit_entries WHERE actor_id=? AND request_id=? FOR UPDATE",[actorId,operation.requestId]);
    // 交易参考号在所有管理员、账号之间唯一；不把不同管理员的新 requestId 当成新转账。
    // 来源 business_reference 使用规范参考号保证唯一；context.entryId 和流水 allocations 保留双向定位。
    const [sources]=await connection.execute<RowDataPacket[]>("SELECT e.* FROM credit_sources s JOIN credit_entries e ON e.id=s.context_snapshot->>'$.entryId' WHERE s.business_type='manual_recharge' AND s.business_reference=?",[operation.receiptReference]);
    const savedRow=requests[0]??sources[0];
    if (savedRow) {
      const saved=creditEntry(savedRow);
      if (saved.businessType!=="manual_recharge" || saved.accountId!==operation.accountId || saved.amount!==amount || saved.context?.receiptReference!==operation.receiptReference || saved.reason!==operation.reason) throw new RechargeConflict("操作 ID 或交易参考号已登记，内容不一致；请核对原流水，不要更换参考号再次入账。",saved);
      await connection.commit();return {entry:saved,replayed:true};
    }
    const before=await readCreditBalance(connection,operation.accountId);
    if (creditUnits(before.purchased.available)+creditUnits(before.purchased.reserved)+creditUnits(amount)>=BigInt(10)**BigInt(28)) throw new CreditError("购买积分总额超过支持上限。",409);
    const id=randomUUID(),sourceId=randomUUID(),now=new Date();
    const context={entryId:id,receiptReference:operation.receiptReference,originalPaidRmb:operation.paidRmb};
    await connection.execute("INSERT INTO credit_sources (id,user_id,kind,business_type,business_reference,original_credits,available,reserved,paid_rmb,context_snapshot,created_at) VALUES (?,?,'purchased','manual_recharge',?,?,?,0,?,?,?)",[sourceId,operation.accountId,operation.receiptReference,amount,amount,operation.paidRmb,JSON.stringify(context),now]);
    const after=await readCreditBalance(connection,operation.accountId),allocations=[{sourceId,amount}];
    await connection.execute("INSERT INTO credit_entries (id,user_id,account_email,actor_id,actor_email,request_id,business_type,reason,amount,source_kind,balance_before,balance_after,allocations,context_snapshot,created_at) VALUES (?,?,?,?,?,?,'manual_recharge',?,?,'purchased',?,?,?,?,?)",[id,target.id,target.email,actorId,actor.email,operation.requestId,operation.reason,amount,JSON.stringify(before),JSON.stringify(after),JSON.stringify(allocations),JSON.stringify(context),now]);
    await connection.commit();
    return {entry:{id,accountId:target.id,accountEmail:target.email,actorId,actorEmail:actor.email,requestId:operation.requestId,businessType:"manual_recharge",reason:operation.reason,amount,sourceKind:"purchased",before,after,allocations,context,createdAt:now.toISOString()},replayed:false};
  } catch(error) {
    await connection.rollback();
    // 唯一键竞争/死锁明确回滚后，重新读取原账；不在未知提交结果上发起新操作。
    if (attempt<2 && ["ER_DUP_ENTRY","ER_LOCK_DEADLOCK"].includes((error as {code?:string}).code??"")) {
      connection.release();released=true;return creditManualRecharge(actorId,operation,attempt+1);
    }
    throw error;
  } finally { if (!released) connection.release(); }
}

export function rechargeFilters(params:URLSearchParams) {
  if ([...params.keys()].some(key=>!["q","page"].includes(key))) throw new CreditError("充值查询仅支持账号或交易参考号筛选与分页。");
  const page=Number(params.get("page")??"1"),q=(params.get("q")??"").trim();
  if (!Number.isSafeInteger(page)||page<1||page>1000000||q.length>320) throw new CreditError("查询条件或页码不正确。");
  return {page,q};
}
export async function listManualRecharges(q="",page=1) {
  const connection=await getMysqlPool().getConnection();
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const where="business_type='manual_recharge' AND (?='' OR user_id=? OR account_email=? OR context_snapshot->>'$.receiptReference'=?)",args=[q,q,q,q.toUpperCase()];
    const [counts]=await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM credit_entries WHERE "+where,args);
    const total=Number(counts[0].total),pageSize=20,currentPage=Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
    const [rows]=await connection.query<RowDataPacket[]>("SELECT * FROM credit_entries WHERE "+where+" ORDER BY sequence DESC LIMIT ? OFFSET ?",[...args,pageSize,(currentPage-1)*pageSize]);
    await connection.commit();return {entries:rows.map(creditEntry),total,page:currentPage,pageSize};
  } catch(error) {await connection.rollback();throw error;} finally {connection.release();}
}
