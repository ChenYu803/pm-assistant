// v1.44 #06：真实应用、独立 MySQL；仅供应商与邮件使用本机受限替身。
// 运行：node --import ./node_modules/tsx/dist/loader.mjs scripts/verify-v144-model-cost.mjs
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";

const modes = new Set(["normal", "prototype", "insufficient-system-resource", "missing", "negative", "fractional", "string", "unsafe", "total-mismatch", "cache-mismatch", "reasoning-invalid", "conflicting", "delayed", "failed-known", "failed-unknown", "interrupted", "disconnect", "stop-known", "stop-unknown"]);
const usage = { prompt_tokens: 1000, prompt_cache_hit_tokens: 400, prompt_cache_miss_tokens: 600, completion_tokens: 100, total_tokens: 1100, completion_tokens_details: { reasoning_tokens: 20 } };
const calls = [], timers = new Set();
let plan;
const provider = createServer(async (req, res) => {
  const sendJson = (status, value) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
  try {
    if (req.method === "GET" && req.url === "/stats") return sendJson(200, { count: calls.length, calls, planned: plan?.mode ?? null });
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 2_000_000) return sendJson(413, { error: "fixture-body-limit" }); }
    const body = JSON.parse(raw || "{}");
    if (req.method === "POST" && req.url === "/control") {
      if (!modes.has(body.mode) || plan) return sendJson(409, { error: "fixture-plan-invalid-or-unconsumed" });
      plan = { mode: body.mode, providerId: "fixture-" + randomUUID(), upstreamId: "upstream-" + randomUUID() };
      return sendJson(200, plan);
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions" || req.headers.authorization !== "Bearer isolated-provider-fixture") return sendJson(403, { error: "fixture-boundary-only" });
    if (!plan) return sendJson(409, { error: "fixture-unplanned-call" });
    const current = plan; plan = undefined;
    const call = { ...current, stream: body.stream === true, includeUsage: body.stream_options?.include_usage === true, requestedModel: body.model, maxTokens: body.max_tokens, phase: "opened", closed: false };
    calls.push(call);
    res.on("close", () => { call.closed = true; });
    res.setHeader("x-request-id", current.upstreamId);
    const common = { id: current.providerId, object: body.stream ? "chat.completion.chunk" : "chat.completion", model: "deepseek-v4-flash", created: Math.floor(Date.now() / 1000) };
    const supplied = structuredClone(usage);
    if (current.mode === "negative") supplied.prompt_cache_hit_tokens = -1;
    if (current.mode === "fractional") supplied.completion_tokens = 100.5;
    if (current.mode === "string") supplied.prompt_tokens = "1000";
    if (current.mode === "unsafe") supplied.total_tokens = Number.MAX_SAFE_INTEGER + 1;
    if (current.mode === "total-mismatch") supplied.total_tokens = 1101;
    if (current.mode === "cache-mismatch") supplied.prompt_cache_miss_tokens = 601;
    if (current.mode === "reasoning-invalid") supplied.completion_tokens_details.reasoning_tokens = 101;
    const content = current.mode === "prototype" ? "供应商正文保护样本：测试回复\n%%%HTML_BEGIN%%%\n<!doctype html><html><head><title>隔离快照</title></head><body>测试原型</body></html>\n%%%HTML_END%%%" : "供应商正文保护样本：测试回复与测试润色。";
    const finishReason = current.mode === "insufficient-system-resource" ? "insufficient_system_resource" : "stop";
    if (!body.stream) {
      if (!["normal", "insufficient-system-resource"].includes(current.mode)) return sendJson(409, { error: "fixture-stream-required" });
      call.phase = "done";
      return sendJson(200, { ...common, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }], usage: supplied });
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    const chunk = (choices, extra = {}) => res.write("data: " + JSON.stringify({ ...common, choices, ...extra }) + "\n\n");
    const finish = () => chunk([{ index: 0, delta: {}, finish_reason: finishReason }]);
    const usageOnly = (value = supplied) => { chunk([], { usage: value }); call.phase = "usage-sent"; };
    const done = () => { call.phase = "done"; res.end("data: [DONE]\n\n"); };
    chunk([{ index: 0, delta: { role: "assistant", content }, finish_reason: null }]);
    call.phase = "text-sent";
    if (current.mode === "interrupted") { call.phase = "eof-without-finish"; return res.end(); }
    if (current.mode === "disconnect") { await delay(150); call.phase = "socket-destroyed"; return res.destroy(); }
    if (current.mode === "failed-unknown") { call.phase = "error-sent"; return res.end('data: {"error":{"message":"供应商异常正文保护样本","type":"server_error","code":"fixture_failure"}}\n\n'); }
    if (current.mode !== "stop-unknown") {
      finish();
      if (current.mode === "delayed") { call.phase = "waiting-usage"; await delay(500); }
      if (current.mode !== "missing") usageOnly();
    }
    if (current.mode.startsWith("stop-")) {
      // 等待正式停止入口取消上游；8 秒保护计时器避免生产取消失效拖满共享 runner。
      const timer = setTimeout(() => { timers.delete(timer); if (!res.destroyed) { call.phase = "stop-timeout"; res.destroy(); } }, 8000);
      timers.add(timer); res.on("close", () => { clearTimeout(timer); timers.delete(timer); }); return;
    }
    if (current.mode === "conflicting") usageOnly({ ...supplied, completion_tokens: 101, total_tokens: 1101 });
    if (current.mode === "failed-known") { call.phase = "error-after-usage"; return res.end('data: {"error":{"message":"供应商异常正文保护样本","type":"server_error","code":"fixture_failure"}}\n\n'); }
    done();
  } catch { if (!res.headersSent) sendJson(500, { error: "fixture-handler-error" }); else res.destroy(); }
});
await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
process.env.AI_MODE = "replay";
let result;
try {
  result = await runIsolatedReplay({ slug: "model-cost", title: "官方模型成本计量（隔离替身，真实 LLM 成本为零）", scenarioScript: "scripts/verify-v144-model-cost-scenario.mjs", designatedAdmin: true, seedLegacyAuth: true, providerFixtureUrl: "http://127.0.0.1:" + provider.address().port + "/v1", expectedWorkflows: 5 });
  await writeFile(join(result.outputDir, "provider-summary.json"), JSON.stringify({ aiMode: "live", scenarioMode: "replay", fixture: true, live: false, realLlmCostCny: "0", unconsumedPlan: plan ?? null, calls }, null, 2));
} finally {
  for (const timer of timers) clearTimeout(timer);
  provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
}
process.exit(result?.fail > 0 || !result ? 1 : 0);
