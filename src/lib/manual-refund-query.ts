import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getMysqlPool } from "@/lib/mysql";
import { creditText,creditUnits } from "@/lib/credit-values";
import type { ManualRefund } from "@/lib/manual-refund-values";

export function refundView(row: RowDataPacket): ManualRefund {
  return { id: row.id, accountId: row.user_id, accountEmail: row.account_email, rechargeEntryId: row.recharge_entry_id, sourceId: row.source_id,
    actorId: row.actor_id, actorEmail: row.actor_email, requestId: row.request_id, refundRmb: creditText(creditUnits(row.refund_rmb)), credits: creditText(creditUnits(row.credits)), reason: row.reason,
    transferStatus: row.transfer_status, accountingStatus: row.accounting_status, externalReference: row.external_reference, transferReason: row.transfer_reason,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
export async function readRefunds(connection: PoolConnection,filter: {q?: string;accountId?: string},page=1) {
  const where=filter.accountId ? "user_id=?" : "(?='' OR user_id=? OR account_email=? OR recharge_entry_id=? OR id=? OR external_reference=?)";
  const q=filter.q??"",args=filter.accountId ? [filter.accountId] : [q,q,q,q,q,q.toUpperCase()];
  const [counts]=await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM credit_refunds WHERE "+where,args);
  const total=Number(counts[0].total),pageSize=20,currentPage=Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
  const [rows]=await connection.query<RowDataPacket[]>("SELECT * FROM credit_refunds WHERE "+where+" ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",[...args,pageSize,(currentPage-1)*pageSize]);
  return {refunds:rows.map(refundView),total,page:currentPage,pageSize};
}
export async function listManualRefunds(filter: {q?: string;accountId?: string},page=1) {
  const connection=await getMysqlPool().getConnection();
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const result=await readRefunds(connection,filter,page);await connection.commit();return result;
  } catch(error) {await connection.rollback();throw error;} finally {connection.release();}
}
