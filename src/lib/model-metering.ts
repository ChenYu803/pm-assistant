import { ModelStoppedError } from "@/lib/model-request-control";
import { randomUUID } from "node:crypto";
import { getMysqlPool } from "@/lib/mysql";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { lockCreditUsers } from "@/lib/credits-ledger";
import { reserveAIRequest } from "@/lib/mysql-ai-budget";
import { CreditError, creditText, creditUnits } from "@/lib/credit-values";
import { reserveConversationCredits, settleConversationCredits, type CreditCallInput } from "@/lib/conversation-credits";
import type { ConversationBudget } from "@/lib/conversation-credit-budget";

export type ModelContext = { purpose?: "chat" | "stage_chat" | "polish"; projectId?: string; sessionId?: string; fileId?: string; awaitProcessing?: boolean; creditCall?: CreditCallInput };
export type ModelReceipt = { id: string; status: string; usageStatus: string; costCny: string | null; costReason: string };
export type ModelUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_cache_hit_tokens: number; prompt_cache_miss_tokens: number; reasoning_tokens?: number };
export type ModelPrice = { version: string; source: string; verifiedAt: string; currency: string; model: string; peak: boolean; inputHitPerMillion: string; inputMissPerMillion: string; outputPerMillion: string };
const PRICE_SOURCE = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";
const HOLIDAYS_2026 = [["01-01", "01-03"], ["02-15", "02-23"], ["04-04", "04-06"], ["05-01", "05-05"], ["06-19", "06-21"], ["09-25", "09-27"], ["10-01", "10-07"]];
const FLASH_MODELS = ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"];
function modelOutcome(finish: string | null): "completed" | "failed" | "interrupted" {
 if (finish === "insufficient_system_resource" || finish === "content_filter") return "failed";
 return finish && ["stop", "length", "tool_calls", "function_call"].includes(finish) ? "completed" : "interrupted";
}
function stoppedModelOutcome(finish: string | null): "stopped" | "failed" | "interrupted" {
 // 传输收尾、锁内停止竞争及正文后处理共用分类，停止不能绕过故障免单。
 const result = modelOutcome(finish);
 return finish === "length" ? "failed" : result === "completed" ? "stopped" : result;
}
function priceAt(date: Date, model: string): ModelPrice | null {
 if (!FLASH_MODELS.includes(model)) return null;
 const china = new Date(date.valueOf() + 8*3600000), iso = china.toISOString(), day = iso.slice(5,10), minute = china.getUTCHours()*60+china.getUTCMinutes();
 // 日历只核实到 2026；未来年份和快照核实前的调用保留待确认，不能静默猜价。
 if (iso.slice(0,4) !== "2026" || iso.slice(0,10) < "2026-11-03") return null;
 const holiday = HOLIDAYS_2026.some(([start,end]) => day >= start && day <= end);
 const weekday = china.getUTCDay() >= 1 && china.getUTCDay() <= 5;
 const peak = weekday && !holiday && ((minute >= 540 && minute < 720) || (minute >= 840 && minute < 1080));
 return { version: "deepseek-flash-cny-2026-11-03", source: PRICE_SOURCE, verifiedAt: "2026-11-03", currency: "CNY", model: "deepseek-flash", peak, inputHitPerMillion: peak ? "0.04" : "0.02", inputMissPerMillion: peak ? "2" : "1", outputPerMillion: peak ? "8" : "4" };
}
function readUsage(value: unknown): ModelUsage | null {
 if (!value || typeof value !== "object") return null;
 const u = value as Record<string, unknown>, pd = u.prompt_tokens_details as Record<string, unknown> | undefined;
 const hit = u.prompt_cache_hit_tokens ?? pd?.cached_tokens;
 const miss = u.prompt_cache_miss_tokens ?? (typeof u.prompt_tokens === "number" && typeof hit === "number" ? u.prompt_tokens - hit : undefined);
 const nums = [u.prompt_tokens, u.completion_tokens, u.total_tokens, hit, miss];
 if (!nums.every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)) return null;
 const [input, output, total, cached, uncached] = nums as number[];
 if (!Number.isSafeInteger(input+output) || input+output !== total || cached+uncached !== input || (pd?.cached_tokens !== undefined && pd.cached_tokens !== cached)) return null;
 const reasoning = (u.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens;
 if (reasoning !== undefined && (typeof reasoning !== "number" || !Number.isSafeInteger(reasoning) || reasoning < 0 || reasoning > output)) return null;
 return { prompt_tokens: input, completion_tokens: output, total_tokens: total, prompt_cache_hit_tokens: cached, prompt_cache_miss_tokens: uncached, ...(reasoning === undefined ? {} : { reasoning_tokens: reasoning as number }) };
}
function costForUsage(usage: ModelUsage, price: ModelPrice) {
 const units = (BigInt(usage.prompt_cache_hit_tokens)*creditUnits(price.inputHitPerMillion) + BigInt(usage.prompt_cache_miss_tokens)*creditUnits(price.inputMissPerMillion) + BigInt(usage.completion_tokens)*creditUnits(price.outputPerMillion))/BigInt(1000000);
 return creditText(units);
}
function utc(date: Date) { return date.toISOString().slice(0,23).replace("T", " "); }
function shortId(value: unknown): string | null { return typeof value === "string" && /^[a-zA-Z0-9_.:/-]{1,160}$/.test(value) ? value : null; }

/** 只记录供应商证据与必要关联，不写消息、文件正文或原始异常内容。 */
export async function startModelRequest(input: ModelContext & { userId: string; model: string; timeoutMs: number; maxTokens: number; transport: "stream" | "completion"; creditBudget?: ConversationBudget }) {
 if (!input.creditCall || !input.creditBudget) throw new CreditError("缺少生成操作标识或费用预算，请刷新后重试。",400);
 const id = randomUUID(), started = new Date();
 // 测试替身可使用官方协议，生产自定义中转地址不能被当作官方价格。
 const url = new URL(process.env.AI_BASE_URL || "https://api.deepseek.com");
 const official = url.protocol === "https:" && url.hostname === "api.deepseek.com" && !url.port && !url.username && !url.password && ["/", "/v1", "/v1/"].includes(url.pathname);
 const fixture = process.env.NODE_ENV !== "production" && process.env.AI_API_KEY === "isolated-provider-fixture" && url.hostname === "127.0.0.1";
 const startPrice = official || fixture ? priceAt(started, input.model) : null;
 const connection = await getMysqlPool().getConnection();
 try {
  await connection.beginTransaction();
  if (input.creditCall) {
   if (!startPrice || !input.creditBudget) throw new CreditError("模型价格或费用边界尚未核实，请联系管理员。",503);
   await reserveConversationCredits(connection,input.userId,id,input.creditCall,input.creditBudget);
   if (input.purpose === "chat") {
    const [messages] = await connection.execute<RowDataPacket[]>("SELECT status FROM messages WHERE id=? FOR UPDATE",[input.creditCall.messageId]);
    if (messages[0]?.status !== "generating") throw new CreditError("生成已停止，请刷新会话。",409);
   }
   if (input.purpose === "stage_chat") {
    const [messages] = await connection.execute<RowDataPacket[]>("SELECT status FROM iteration_session_messages WHERE id=? FOR UPDATE",[input.creditCall.messageId]);
    if (messages[0]?.status !== "generating") throw new CreditError("生成已停止，请刷新会话。",409);
   }
  }
  // 资金与每日次数同事务授权，余额不足不消耗次数。
  await reserveAIRequest(input.userId, process.env, getMysqlPool(), started, connection);
 await connection.execute("INSERT INTO model_requests (id,user_id,purpose,project_id,session_id,file_id,requested_model,max_output_tokens,transport,started_at,deadline_at,status,usage_status,cost_reason,price_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,'running','pending','awaiting_usage',?)", [id,input.userId,input.purpose ?? "chat",input.projectId ?? null,input.sessionId ?? null,input.fileId ?? null,input.model,input.maxTokens,input.transport,utc(started),utc(new Date(started.valueOf()+input.timeoutMs+60000)),JSON.stringify({ start: startPrice, official, fixture })]);
  await connection.commit();
 } catch(error) { await connection.rollback(); throw error; } finally { connection.release(); }
 let usage: ModelUsage | null = null, invalid = false, providerId: string | null = null, actualModel: string | null = null, finish: string | null = null, upstreamId: string | null = null;
 function observe(chunk: { id?: unknown; model?: unknown; usage?: unknown; choices?: { finish_reason?: unknown }[] }) {
  providerId = shortId(chunk.id) ?? providerId; actualModel = shortId(chunk.model) ?? actualModel;
  const reason = chunk.choices?.[0]?.finish_reason;
  if (typeof reason === "string") finish = reason.slice(0,64);
  if (chunk.usage != null) { const next = readUsage(chunk.usage); if (!next || (usage && JSON.stringify(usage) !== JSON.stringify(next))) invalid = true; else usage = next; }
 }
 async function finishRequest(status: "completed" | "stopped" | "failed" | "interrupted", errorCode: string | null = null): Promise<ModelReceipt> {
  const ended = new Date(), endPrice = official || fixture ? priceAt(ended, actualModel ?? input.model) : null;
  const reliable = !!usage && !invalid && !!finish;
  const sameWindow = startPrice && endPrice && startPrice.peak === endPrice.peak && started.toISOString().slice(0,10) === ended.toISOString().slice(0,10) && ended.valueOf()-started.valueOf() < 3600000;
  let costCny: string | null = null;
  const costReason = !reliable ? "usage_unconfirmed" : !sameWindow ? "price_unconfirmed" : "confirmed";
  if (reliable && sameWindow) {
   // 推理 tokens 已包含在 completion_tokens 中，不能重复加收。
   costCny = costForUsage(usage!, startPrice);
  }
  // 供应商完成与正文保存分开确认；正文保存前崩溃仍留有持久可恢复的 processing 状态。
  const persistedStatus = status === "completed" && input.awaitProcessing ? "processing" : status;
  let receipt: ModelReceipt = { id,status: persistedStatus,usageStatus: reliable ? "reliable" : "pending",costCny,costReason };
  const persist = async (siteFailure = false) => withModelAccountTransaction(id, async connection => {
   const [rows] = await connection.execute<RowDataPacket[]>("SELECT m.*,c.state AS credit_state FROM model_requests m JOIN conversation_credit_calls c ON c.id=m.id WHERE m.id=? FOR UPDATE",[id]);
   const previous = rows[0];
   const terminal = ["settled","released"].includes(previous.credit_state);
   // 免单和已扣费终态不可被重试改写；迟到证据只补网站成本。
   if (terminal || previous.credit_state === "pending" || ["failed","interrupted"].includes(previous.status)) {
    // 已结束的同一次请求使用其原始价格窗口；核对发生时间不改变原请求价格。
    // 没有原结束证据（如请求前失败）时，仍保留原有跨窗口不确定性。
    const originalPrice = previous.finish_reason && previous.ended_at ? previous.price_json : null;
    const evidencePrice = originalPrice ?? {start:startPrice,end:endPrice,official,fixture,rule:"same_price_window_only",windowConfirmed:Boolean(sameWindow)};
    let recoveredCost = reliable ? costCny : null;
    if (reliable && originalPrice) {
     recoveredCost = originalPrice.windowConfirmed && originalPrice.start && FLASH_MODELS.includes(actualModel ?? previous.actual_model ?? input.model)
      ? costForUsage(usage!,originalPrice.start) : null;
    }
    const recoveredReason = recoveredCost === null ? "price_unconfirmed" : "confirmed";
    if ((previous.website_borne || previous.credit_state === "pending") && previous.cost_cny === null && reliable && (previous.usage_status !== "reliable" || recoveredCost !== null)) {
     await connection.execute("UPDATE model_requests SET actual_model=?,provider_id=?,upstream_request_id=?,finish_reason=?,usage_status='reliable',usage_json=?,price_json=?,cost_cny=?,cost_reason=? WHERE id=?",[actualModel,providerId,upstreamId,finish,JSON.stringify(usage),JSON.stringify({...evidencePrice,usageValidated:!invalid}),recoveredCost,recoveredReason,id]);
     previous.usage_status = "reliable"; previous.cost_cny = recoveredCost; previous.cost_reason = recoveredReason;
    }
    await settleConversationCredits(id,connection);
    receipt = {id,status:previous.status,usageStatus:previous.usage_status,costCny:previous.cost_cny,costReason:previous.cost_reason};
    return;
   }
   const stoppedAtSettlement = status === "stopped" || (status === "completed" || (status === "interrupted" && errorCode === null)) && Boolean(previous.stop_requested_at || previous.status === "stopped");
   const finalStatus = siteFailure ? "failed" : stoppedAtSettlement ? stoppedModelOutcome(finish) : persistedStatus;
   const finalError = siteFailure ? "site_settlement_error" : finalStatus === "stopped" ? "user_stop" : stoppedAtSettlement ? finalStatus === "failed" ? "upstream_finish_error" : "finish_unconfirmed" : errorCode;
   const failure = ["failed","interrupted"].includes(finalStatus);
   await connection.execute("UPDATE model_requests SET actual_model=?,provider_id=?,upstream_request_id=?,ended_at=?,status=?,finish_reason=?,error_code=?,usage_status=?,usage_json=?,price_json=?,cost_cny=?,cost_reason=?,website_borne=? WHERE id=?", [actualModel,providerId,upstreamId,utc(ended),finalStatus,finish,finalError,reliable ? "reliable" : "pending",usage ? JSON.stringify(usage) : null,JSON.stringify({ start: startPrice, end: endPrice, official, fixture, rule: "same_price_window_only", windowConfirmed: Boolean(sameWindow), usageValidated: !invalid }),costCny,costReason,failure,id]);
   if (finalStatus !== "processing") await settleConversationCredits(id, connection);
   receipt.status = finalStatus;
  });
  try { await persist(); }
  catch { // 写入回滚后尝试故障免单；若 commit 已成功，终态保护会返回原结果。
   await persist(true);
  }
  return receipt;
 }
 return { id, observe, upstream(value: unknown) { upstreamId = shortId(value); }, finish: finishRequest,
  outcome: () => modelOutcome(finish), stoppedOutcome: () => stoppedModelOutcome(finish),
 };
}

/** 应用收到可靠供应商结果后，若正文持久化等网站步骤失败，成本继续保留并由网站承担。 */
export async function markModelProcessingFailure(id: string | undefined, stopped = false) {
 if (!id) return;
 try {
  await withModelAccountTransaction(id, async connection => {
  const [rows] = await connection.execute<RowDataPacket[]>("SELECT status,finish_reason FROM model_requests WHERE id=? FOR UPDATE",[id]);
  if (rows[0] && ["running","processing"].includes(rows[0].status)) {
   const status = stopped ? stoppedModelOutcome(rows[0].finish_reason) : "failed";
   const errorCode = !stopped ? "site_processing_error" : status === "stopped" ? "site_processing_stopped" : status === "failed" ? "upstream_finish_error" : "finish_unconfirmed";
   await connection.execute("UPDATE model_requests SET status=?, website_borne=?, error_code=? WHERE id=? AND status IN ('running','processing')",[status, status !== "stopped", errorCode, id]);
  }
  await settleConversationCredits(id, connection);
  });
 } catch {
  // 补标失败不能阻断会话和冻结操作清理；仅记录安全关联标识，不输出正文或底层异常。
  console.error("model_processing_failure_mark_failed", { requestId: id });
 }
}

/** 正文保存前先检查持久终态；调用方须已持账号锁。 */
export async function assertModelProcessingActive(id: string | undefined, transaction: PoolConnection) {
 if (!id) return;
 const [rows] = await transaction.execute<RowDataPacket[]>("SELECT stop_requested_at,status FROM model_requests WHERE id=? FOR UPDATE",[id]);
 if (rows[0]?.stop_requested_at || rows[0]?.status === "stopped") throw new ModelStoppedError();
 if (!["processing","completed"].includes(rows[0]?.status)) throw new Error("生成已失败，本次免单，请重试。");
}

/** 必须在正文及必要业务操作持久化之后确认完成；与正文共用事务。 */
export async function completeModelProcessing(id: string | undefined, connection?: import("mysql2/promise").PoolConnection) {
 if (!id) return;
 const complete = async (transaction: PoolConnection) => {
  await assertModelProcessingActive(id,transaction);
  await transaction.execute("UPDATE model_requests SET status='completed', website_borne=FALSE WHERE id=? AND status='processing' AND stop_requested_at IS NULL", [id]);
  await settleConversationCredits(id, transaction);
 };
 if (connection) await complete(connection);
 else await withModelAccountTransaction(id, complete);
}

/** 先锁账号再写模型状态，终态与资金变动原子提交；外部 HTTP 不在事务内。 */
async function withModelAccountTransaction(id: string, work: (connection: PoolConnection) => Promise<void>) {
 const [owners] = await getMysqlPool().execute<RowDataPacket[]>("SELECT user_id FROM model_requests WHERE id=?", [id]);
 if (!owners.length) return;
 const connection = await getMysqlPool().getConnection();
 try {
  await connection.beginTransaction();
  await lockCreditUsers(connection, [owners[0].user_id]);
  await work(connection);
  await connection.commit();
 } catch (error) { await connection.rollback(); throw error; }
 finally { connection.release(); }
}
