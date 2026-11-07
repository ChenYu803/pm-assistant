// #06/#07 共用的本机供应商协议替身；控制端点只绑定随机 127.0.0.1 端口。
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";


export async function withModelProvider(run) {
const modes = new Set(["normal", "hold", "request-error", "tiny", "output-length", "context-document", "over-budget", "prototype", "insufficient-system-resource", "missing", "negative", "fractional", "string", "unsafe", "total-mismatch", "cache-mismatch", "reasoning-invalid", "conflicting", "delayed", "failed-known", "failed-unknown", "interrupted", "disconnect", "stop-known", "stop-unknown", "held-usage", "stop-delayed-usage", "stop-delayed-missing", "stop-delayed-disconnect", "hold-missing", "hold-timeout", "stop-delayed-resource-error", "stop-delayed-content-filter", "stop-delayed-length", "stop-delayed-unknown-finish", "stop-delayed-no-finish", "hold-http-error"]);
const usage = { prompt_tokens: 1000, prompt_cache_hit_tokens: 400, prompt_cache_miss_tokens: 600, completion_tokens: 100, total_tokens: 1100, completion_tokens_details: { reasoning_tokens: 20 } };
const calls = [], timers = new Set(), heldUsage = new Map();
let plan;
const queue = [];
const provider = createServer(async (req, res) => {
  const sendJson = (status, value) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
  try {
    if (req.method === "GET" && req.url === "/stats") return sendJson(200, { count: calls.length, calls, planned: plan?.mode ?? null });
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 2_000_000) return sendJson(413, { error: "fixture-body-limit" }); }
    const body = JSON.parse(raw || "{}");
    if (req.method === "POST" && req.url === "/control") {
      if (!modes.has(body.mode)) return sendJson(409, { error: "fixture-plan-invalid-or-unconsumed" });
      const added = { mode: body.mode, providerId: "fixture-" + randomUUID(), upstreamId: "upstream-" + randomUUID() };
      if (!plan) plan = added; else queue.push(added);
      return sendJson(200, added);
    }
    // 只释放本替身尚未结束的供应商响应，不接触应用状态或账本。
    if (req.method === "POST" && req.url === "/release-usage") {
      const release = heldUsage.get(body.providerId);
      if (!release) return sendJson(409, { error: "fixture-usage-not-held" });
      release(true);
      return sendJson(200, { providerId: body.providerId, released: true });
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions" || req.headers.authorization !== "Bearer isolated-provider-fixture") return sendJson(403, { error: "fixture-boundary-only" });
    if (!plan) return sendJson(409, { error: "fixture-unplanned-call" });
    const current = plan; plan = queue.shift();
    const call = { ...current, stream: body.stream === true, includeUsage: body.stream_options?.include_usage === true, requestedModel: body.model, maxTokens: body.max_tokens, inputBytes: Buffer.byteLength(JSON.stringify(body.messages),"utf8"), messageCount: body.messages.length, fullContextIncluded: body.messages.some(message => message.role === "system" && message.content.includes("V144_CREDIT_CONTEXT_中文😀".repeat(128))), inputHashes: body.messages.map(message => createHash("sha256").update(message.content ?? "").digest("hex")), phase: "opened", closed: false };
    calls.push(call);
    res.on("close", () => { call.closed = true; });
    // 只控制供应商边界；连接被客户端关闭会立即结束等待并移除控制柄。
    const waitForRelease = async (waitingPhase, closedPhase, timeoutPhase) => {
      call.phase = waitingPhase;
      return new Promise(resolveHold => {
        const close = () => { call.phase = closedPhase; release(false); };
        const release = accepted => {
          heldUsage.delete(current.providerId);
          clearTimeout(timer); timers.delete(timer); res.off("close", close);
          resolveHold(accepted);
        };
        const timer = setTimeout(() => {
          call.phase = timeoutPhase;
          release(false); res.destroy();
        }, 60000);
        timers.add(timer); heldUsage.set(current.providerId, release); res.once("close", close);
      });
    };
    res.setHeader("x-request-id", current.upstreamId);
    if (current.mode === "request-error") { call.phase = "request-error"; return sendJson(503,{error:{message:"隔离供应商故障",code:"fixture_failure"}}); }
    const common = { id: current.providerId, object: body.stream ? "chat.completion.chunk" : "chat.completion", model: "deepseek-v4-flash", created: Math.floor(Date.now() / 1000) };
    const supplied = current.mode === "tiny" ? { prompt_tokens:1,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:1,completion_tokens:1,total_tokens:2 } : structuredClone(usage);
    if (current.mode === "over-budget") Object.assign(supplied, {prompt_tokens:200000,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:200000,total_tokens:200100});
    if (current.mode === "negative") supplied.prompt_cache_hit_tokens = -1;
    if (current.mode === "fractional") supplied.completion_tokens = 100.5;
    if (current.mode === "string") supplied.prompt_tokens = "1000";
    if (current.mode === "unsafe") supplied.total_tokens = Number.MAX_SAFE_INTEGER + 1;
    if (current.mode === "total-mismatch") supplied.total_tokens = 1101;
    if (current.mode === "cache-mismatch") supplied.prompt_cache_miss_tokens = 601;
    if (current.mode === "reasoning-invalid") supplied.completion_tokens_details.reasoning_tokens = 101;
    const content = current.mode === "context-document" ? "%%%FILE_BEGIN%%% 需求分析-积分样本.md\n# 积分上下文\n" + "V144_CREDIT_CONTEXT_中文😀".repeat(128) + "\n%%%FILE_END%%%" : current.mode === "prototype" ? "供应商正文保护样本：测试回复\n%%%HTML_BEGIN%%%\n<!doctype html><html><head><title>隔离快照</title></head><body>测试原型</body></html>\n%%%HTML_END%%%" : "供应商正文保护样本：测试回复与测试润色。";
    const finishReason = ["insufficient-system-resource","failed-known","failed-unknown","stop-delayed-resource-error"].includes(current.mode) ? "insufficient_system_resource" : current.mode === "stop-delayed-content-filter" ? "content_filter" : ["output-length","stop-delayed-length"].includes(current.mode) ? "length" : current.mode === "stop-delayed-unknown-finish" ? "fixture_unknown" : "stop";
    if (!body.stream) {
      if (!["normal", "tiny", "hold", "missing", "over-budget", "output-length", "insufficient-system-resource", "failed-known", "failed-unknown", "disconnect", "hold-missing", "hold-timeout", "hold-http-error"].includes(current.mode)) return sendJson(409, { error: "fixture-stream-required" });
      if (current.mode === "hold-http-error") {
        if (!await waitForRelease("waiting-completion-error", "closed-before-completion-error", "completion-error-release-timeout")) return;
        call.released = true; call.phase = "http-error-after-stop";
        return sendJson(503,{error:{message:"停止后隔离供应商故障",code:"fixture_failure"}});
      }
      if (["hold", "hold-missing"].includes(current.mode)) await delay(2500);
      if (current.mode === "hold-timeout" && !await waitForRelease("waiting-completion-timeout", "closed-before-completion-timeout", "completion-release-timeout")) return;
      if (current.mode === "disconnect") { res.writeHead(200,{"Content-Type":"application/json"});res.write("{\"id\":");await delay(100);return res.destroy(); }
      call.phase = "done";
      return sendJson(200, { ...common, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }], ...(["missing","failed-unknown","hold-missing"].includes(current.mode) ? {} : {usage:supplied}) });
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    const chunk = (choices, extra = {}) => res.write("data: " + JSON.stringify({ ...common, choices, ...extra }) + "\n\n");
    if (current.mode === "hold") await delay(2500);
    const finish = () => chunk([{ index: 0, delta: {}, finish_reason: finishReason }]);
    const usageOnly = (value = supplied) => { chunk([], { usage: value }); call.phase = "usage-sent"; };
    const done = () => { call.phase = "done"; res.end("data: [DONE]\n\n"); };
    chunk([{ index: 0, delta: { role: "assistant", content }, finish_reason: null }]);
    call.phase = "text-sent";
    if (current.mode === "interrupted") { call.phase = "eof-without-finish"; return res.end(); }
    if (current.mode === "disconnect") { await delay(150); call.phase = "socket-destroyed"; return res.destroy(); }
    if (current.mode === "failed-unknown") { call.phase = "error-sent"; return res.end('data: {"error":{"message":"供应商异常正文保护样本","type":"server_error","code":"fixture_failure"}}\n\n'); }
    if (current.mode.startsWith("stop-delayed-")) {
      // 停止前只有正文，绝不提前发送finish或usage。
      const released = await waitForRelease("waiting-stop-usage-release", "closed-before-stop-usage-release", "stop-usage-release-timeout");
      if (!released || res.destroyed) return;
      call.released = true;
      chunk([{ index: 0, delta: { content: "停止后禁止保存的尾文\n%%%FILE_BEGIN%%% 停止后禁止保存.md\n# 停止后的候选\n%%%FILE_END%%%" }, finish_reason: null }]);
      if (current.mode === "stop-delayed-disconnect") {
        call.phase = "socket-destroyed-after-stop";
        await delay(50); return res.destroy();
      }
      if (current.mode !== "stop-delayed-no-finish") finish();
      if (["stop-delayed-usage","stop-delayed-resource-error","stop-delayed-content-filter","stop-delayed-length","stop-delayed-unknown-finish"].includes(current.mode)) usageOnly();
      done(); return;
    }
    if (current.mode !== "stop-unknown") {
      finish();
      if (current.mode === "delayed") { call.phase = "waiting-usage"; await delay(500); }
      if (current.mode === "held-usage") {
        const released = await waitForRelease("waiting-usage-release", "closed-before-usage-release", "usage-release-timeout");
        if (!released || res.destroyed) return;
      }
      if (current.mode !== "missing") usageOnly();
    }
    if (current.mode === "stop-unknown") finish(); // 只有缺usage，finish正常，才能验证停止待核对。
    if (current.mode.startsWith("stop-")) {
      // 兼容既有停止样本的观察窗口；8秒后由供应商自然结束，不依赖用户停止取消连接。
      // stop-unknown全程不发送usage，绝不能用已知用量替代缺失证据。
      const timer = setTimeout(() => { timers.delete(timer); if (!res.destroyed) done(); }, 8000);
      timers.add(timer); res.on("close", () => { clearTimeout(timer); timers.delete(timer); }); return;
    }
    if (current.mode === "conflicting") usageOnly({ ...supplied, completion_tokens: 101, total_tokens: 1101 });
    if (current.mode === "failed-known") { call.phase = "error-after-usage"; return res.end('data: {"error":{"message":"供应商异常正文保护样本","type":"server_error","code":"fixture_failure"}}\n\n'); }
    done();
  } catch { if (!res.headersSent) sendJson(500, { error: "fixture-handler-error" }); else res.destroy(); }
});
await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
try { return await run("http://127.0.0.1:"+provider.address().port+"/v1", () => ({ calls, planned:plan??null })); }
finally { for (const release of heldUsage.values()) release(false); for (const timer of timers) clearTimeout(timer); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); }
}
