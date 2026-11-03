import { randomUUID } from "node:crypto";
import { getMysqlPool } from "@/lib/mysql";
import { creditText, creditUnits } from "@/lib/credit-values";

export type ModelContext = { purpose?: "chat" | "stage_chat" | "polish"; projectId?: string; sessionId?: string; fileId?: string; awaitProcessing?: boolean };
export type ModelReceipt = { id: string; status: string; usageStatus: string; costCny: string | null; costReason: string };
export type ModelUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_cache_hit_tokens: number; prompt_cache_miss_tokens: number; reasoning_tokens?: number };
export type ModelPrice = { version: string; source: string; verifiedAt: string; currency: string; model: string; peak: boolean; inputHitPerMillion: string; inputMissPerMillion: string; outputPerMillion: string };
const PRICE_SOURCE = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";
const HOLIDAYS_2026 = [["01-01", "01-03"], ["02-15", "02-23"], ["04-04", "04-06"], ["05-01", "05-05"], ["06-19", "06-21"], ["09-25", "09-27"], ["10-01", "10-07"]];
const FLASH_MODELS = ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"];
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
function utc(date: Date) { return date.toISOString().slice(0,23).replace("T", " "); }
function shortId(value: unknown): string | null { return typeof value === "string" && /^[a-zA-Z0-9_.:/-]{1,160}$/.test(value) ? value : null; }

/** 只记录供应商证据与必要关联，不写消息、文件正文或原始异常内容。 */
export async function startModelRequest(input: ModelContext & { userId: string; model: string; timeoutMs: number; maxTokens: number; transport: "stream" | "completion" }) {
 const id = randomUUID(), started = new Date();
 // 测试替身可使用官方协议，生产自定义中转地址不能被当作官方价格。
 const url = new URL(process.env.AI_BASE_URL || "https://api.deepseek.com");
 const official = url.protocol === "https:" && url.hostname === "api.deepseek.com" && !url.port && !url.username && !url.password && ["/", "/v1", "/v1/"].includes(url.pathname);
 const fixture = process.env.NODE_ENV !== "production" && process.env.AI_API_KEY === "isolated-provider-fixture" && url.hostname === "127.0.0.1";
 const startPrice = official || fixture ? priceAt(started, input.model) : null;
 await getMysqlPool().execute("INSERT INTO model_requests (id,user_id,purpose,project_id,session_id,file_id,requested_model,max_output_tokens,transport,started_at,deadline_at,status,usage_status,cost_reason,price_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,'running','pending','awaiting_usage',?)", [id,input.userId,input.purpose ?? "chat",input.projectId ?? null,input.sessionId ?? null,input.fileId ?? null,input.model,input.maxTokens,input.transport,utc(started),utc(new Date(started.valueOf()+input.timeoutMs+60000)),JSON.stringify({ start: startPrice, official, fixture })]);
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
   const u = usage!;
   // 推理 tokens 已包含在 completion_tokens 中，不能重复加收。每项均精确到人民币八位小数。
   const units = (BigInt(u.prompt_cache_hit_tokens)*creditUnits(startPrice.inputHitPerMillion) + BigInt(u.prompt_cache_miss_tokens)*creditUnits(startPrice.inputMissPerMillion) + BigInt(u.completion_tokens)*creditUnits(startPrice.outputPerMillion))/BigInt(1000000);
   costCny = creditText(units);
  }
  // 供应商完成与正文保存分开确认；正文保存前崩溃仍留有持久可恢复的 processing 状态。
  const persistedStatus = status === "completed" && input.awaitProcessing ? "processing" : status;
  await getMysqlPool().execute("UPDATE model_requests SET actual_model=?,provider_id=?,upstream_request_id=?,ended_at=?,status=?,finish_reason=?,error_code=?,usage_status=?,usage_json=?,price_json=?,cost_cny=?,cost_reason=?,website_borne=? WHERE id=?", [actualModel,providerId,upstreamId,utc(ended),persistedStatus,finish,errorCode,reliable ? "reliable" : "pending",usage ? JSON.stringify(usage) : null,JSON.stringify({ start: startPrice, end: endPrice, official, fixture, rule: "same_price_window_only", usageValidated: !invalid }),costCny,costReason,status === "failed" || status === "interrupted",id]);
  return { id,status: persistedStatus,usageStatus: reliable ? "reliable" : "pending",costCny,costReason };
 }
 return { id, observe, upstream(value: unknown) { upstreamId = shortId(value); }, finish: finishRequest, outcome(): "completed" | "failed" | "interrupted" {
  if (finish === "insufficient_system_resource" || finish === "content_filter") return "failed";
  return finish && ["stop", "length", "tool_calls", "function_call"].includes(finish) ? "completed" : "interrupted";
 } };
}

/** 应用收到可靠供应商结果后，若正文持久化等网站步骤失败，成本继续保留并由网站承担。 */
export async function markModelProcessingFailure(id: string | undefined, stopped = false) {
 if (!id) return;
 try {
  await getMysqlPool().execute("UPDATE model_requests SET status=?, website_borne=?, error_code=? WHERE id=? AND status IN ('completed','processing')",[stopped ? "stopped" : "failed", !stopped, stopped ? "site_processing_stopped" : "site_processing_error", id]);
 } catch {
  // 补标失败不能阻断会话和冻结操作清理；仅记录安全关联标识，不输出正文或底层异常。
  console.error("model_processing_failure_mark_failed", { requestId: id });
 }
}

/** 必须在正文及必要业务操作持久化之后确认完成；阶段会话与正文共用事务。 */
export async function completeModelProcessing(id: string | undefined, connection?: import("mysql2/promise").PoolConnection) {
 if (!id) return;
 await (connection ?? getMysqlPool()).execute("UPDATE model_requests SET status='completed', website_borne=FALSE WHERE id=? AND status='processing'", [id]);
}
