import type { RowDataPacket } from "mysql2/promise";
import type { ModelUsage, ModelPrice } from "@/lib/model-metering";
import { getMysqlPool } from "@/lib/mysql";
import { creditText, creditUnits } from "@/lib/credit-values";

type ModelRequestRow = RowDataPacket & {
 id: string; userId: string; purpose: string; projectId: string | null; sessionId: string | null; fileId: string | null;
 requestedModel: string; maxOutputTokens: number; transport: string; actualModel: string | null; providerId: string | null; upstreamRequestId: string | null;
 startedAt: string; endedAt: string | null; status: string; finishReason: string | null; errorCode: string | null;
 usageStatus: string; usageData: ModelUsage | null; price: { start: ModelPrice | null; end?: ModelPrice | null; fixture: boolean; official: boolean } | null;
 costCny: string | null; costReason: string; websiteBorne: number;
};
export const MODEL_REQUEST_STATUSES = ["running", "processing", "completed", "stopped", "failed", "interrupted"] as const;
export function modelRequestQuery(params: URLSearchParams) {
 const q = (params.get("q") ?? "").trim(), status = params.get("status") ?? "all", usage = params.get("usage") ?? "all", page = Number(params.get("page") ?? "1");
 if (q.length > 160 || !["all", ...MODEL_REQUEST_STATUSES].includes(status) || !["all", "reliable", "pending"].includes(usage) || !Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new Error("invalid-query");
 return { q, status, usage, page };
}
export async function listModelRequests(query: ReturnType<typeof modelRequestQuery>) {
 const pool = getMysqlPool(), connection = await pool.getConnection();
 try {
 await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
 await connection.beginTransaction();
 // 超过请求期限仍未落终态的进程退出/写库故障，读取时明确显示中断，后续核对不能按零处理。
 const abandoned = "(status IN ('running','processing') AND deadline_at < UTC_TIMESTAMP(3))";
 const effective = "CASE WHEN " + abandoned + " THEN 'interrupted' ELSE status END";
 const websiteBorne = "(website_borne OR " + abandoned + ")";
 const filters: string[] = [], values: string[] = [];
 // ID 按字节精确比较，避免中文搜索词被强制转为 ascii 后触发数据库错误。
 if (query.q) { filters.push("(CAST(id AS BINARY) = CAST(? AS BINARY) OR CAST(user_id AS BINARY) = CAST(? AS BINARY) OR CAST(provider_id AS BINARY) = CAST(? AS BINARY) OR CAST(upstream_request_id AS BINARY) = CAST(? AS BINARY))"); values.push(query.q, query.q, query.q, query.q); }
 if (query.status !== "all") { filters.push(effective + " = ?"); values.push(query.status); }
 if (query.usage !== "all") { filters.push("usage_status = ?"); values.push(query.usage); }
 const where = filters.length ? " WHERE " + filters.join(" AND ") : "";
 const [counts] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM model_requests" + where, values);
 const total = Number(counts[0].total), pageSize = 20, page = Math.min(query.page, Math.max(1, Math.ceil(total/pageSize)));
 const [rows] = await connection.query<ModelRequestRow[]>("SELECT id, user_id AS userId, purpose, project_id AS projectId, session_id AS sessionId, file_id AS fileId, requested_model AS requestedModel, max_output_tokens AS maxOutputTokens, transport, actual_model AS actualModel, provider_id AS providerId, upstream_request_id AS upstreamRequestId, DATE_FORMAT(started_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS startedAt, DATE_FORMAT(ended_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS endedAt, " + effective + " AS status, finish_reason AS finishReason, error_code AS errorCode, usage_status AS usageStatus, usage_json AS usageData, price_json AS price, cost_cny AS costCny, cost_reason AS costReason, " + websiteBorne + " AS websiteBorne FROM model_requests" + where + " ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?", [...values, pageSize, (page-1)*pageSize]);
 const [summary] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS requests, COALESCE(SUM(cost_cny), 0) AS confirmed, COALESCE(SUM(cost_cny IS NULL), 0) AS pending, COALESCE(SUM(CASE WHEN " + websiteBorne + " THEN cost_cny ELSE 0 END), 0) AS website, COALESCE(SUM(" + websiteBorne + " AND cost_cny IS NULL), 0) AS website_pending FROM model_requests");
 await connection.commit();
 return { requests: rows.map(({ usageData, ...row }) => ({ ...row, usage: usageData, websiteBorne: Boolean(row.websiteBorne) })), total, page, pageSize, summary: { requests: Number(summary[0].requests), confirmedCostCny: creditText(creditUnits(String(summary[0].confirmed))), pending: Number(summary[0].pending), websiteCostCny: creditText(creditUnits(String(summary[0].website))), websitePending: Number(summary[0].website_pending), budgetCny: "200", budgetPeriod: "本轮开发验证至首批试用累计，不按月重置", historicalCoverage: "仅统计计量上线后写入的请求；此前模型验证支出尚未补录，不能据此认定剩余预算。" } };
 } catch(error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
