import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getMysqlPool } from "@/lib/mysql";
import { lockCreditUsers } from "@/lib/credits-ledger";

export class ModelStoppedError extends Error {
  constructor() { super("生成已停止"); this.name = "ModelStoppedError"; }
}

/** 调用方先持账号锁；取消只登记意图，不凭浏览器状态释放资金。 */
export async function requestModelStop(connection: PoolConnection, userId: string, match: { requestKey: string; fileId: string } | { messageId: string }) {
  const condition = "messageId" in match ? "c.message_id=?" : "c.request_key=? AND m.file_id=? AND m.purpose='polish'";
  const values = "messageId" in match ? [match.messageId] : [match.requestKey,match.fileId];
  await connection.execute("UPDATE model_requests m JOIN conversation_credit_calls c ON c.id=m.id SET c.reason=CASE WHEN c.state='reserved' AND m.status='running' THEN 'stopped_collecting_usage' ELSE c.reason END,m.stop_requested_at=COALESCE(m.stop_requested_at,UTC_TIMESTAMP(3)) WHERE c.user_id=? AND " + condition + " AND c.state IN ('reserved','pending') AND m.status IN ('running','processing','stopped')",[userId,...values]);
}

export async function stopPolishRequest(userId: string, requestKey: string, fileId: string) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    await lockCreditUsers(connection,[userId]);
    await requestModelStop(connection,userId,{requestKey,fileId});
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

/** 每个真实请求查询持久停止意图；此信号控制展示与结果采用，不关闭供应商连接。查询失败保留原生成。 */
export function watchModelStop(id: string, signal?: AbortSignal) {
  const controller = new AbortController();
  const stop = () => controller.abort("user_stop");
  const abort = () => { if (signal?.reason === "user_stop") stop(); };
  signal?.addEventListener("abort",abort,{once:true});
  if (signal?.aborted) abort();
  let querying: Promise<void> | null = null;
  const refresh = async (fresh = false) => {
    // 收尾强制读一次最新意图；不能复用停止事务提交之前启动的旧查询。
    if (querying) { await querying; if (!fresh) return; }
    if (controller.signal.aborted) return;
    const pending = (async () => {
      try {
        const [rows] = await getMysqlPool().execute<RowDataPacket[]>("SELECT stop_requested_at FROM model_requests WHERE id=?",[id]);
        if (rows[0]?.stop_requested_at) stop();
      } catch { /* 数据库短暂不可用不能被当作主动停止或零用量。 */ }
    })();
    querying = pending;
    try { await pending; }
    finally { if (querying === pending) querying = null; }
  };
  const timer = setInterval(() => { void refresh(); },250);
  return { signal:controller.signal, refresh, dispose() { clearInterval(timer);signal?.removeEventListener("abort",abort); } };
}
