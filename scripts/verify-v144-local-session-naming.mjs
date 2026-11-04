// v1.44 #01：独立空库与本机 HTTP 模型替身，不访问真实供应商。
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";

const requests = [];
let hold = false;
const pending = new Set();
function release() { hold = false; for (const finish of pending) finish(); pending.clear(); }
const provider = createServer(async (request, response) => {
  if (request.url === "/requests") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(requests)); return; }
  if (request.url === "/hold") { hold = true; response.end("ok"); return; }
  if (request.url === "/release") { release(); response.end("ok"); return; }
  if (request.url !== "/v1/chat/completions" || request.method !== "POST") { response.writeHead(404).end(); return; }
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const data = JSON.parse(body);
    requests.push(data);
    // 沿用模型计量替身的可靠用量和正常结束格式，正常回复完成后释放未用预留。
    const common = { id: "fixture-" + randomUUID(), object: data.stream ? "chat.completion.chunk" : "chat.completion", model: "deepseek-v4-flash", created: Math.floor(Date.now() / 1000) };
    const usage = { prompt_tokens: 1000, prompt_cache_hit_tokens: 400, prompt_cache_miss_tokens: 600, completion_tokens: 100, total_tokens: 1100, completion_tokens_details: { reasoning_tokens: 20 } };
    const finish = () => {
      if (response.destroyed) return;
      if (data.stream) {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunk = (choices, extra = {}) => 'data: ' + JSON.stringify({ ...common, choices, ...extra }) + '\n\n';
        response.end(chunk([{ index: 0, delta: { role: "assistant", content: "已收到，我们继续讨论。" }, finish_reason: null }])
          + chunk([{ index: 0, delta: {}, finish_reason: "stop" }])
          + chunk([], { usage }) + 'data: [DONE]\n\n');
      } else {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ ...common, choices: [{ index: 0, message: { role: "assistant", content: "旧模型命名不应触发" }, finish_reason: "stop" }], usage }));
      }
    };
    if (hold) { pending.add(finish); response.once("close", () => pending.delete(finish)); }
    else finish();
  } catch { response.writeHead(400).end(); }
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const origin = 'http://127.0.0.1:' + provider.address().port;
process.env.AI_MODE = "replay";
process.env.REGISTRATION_MODE = "open";
process.env.V144_PROVIDER_ORIGIN = origin;
let result;
try {
  result = await runIsolatedReplay({ slug: "local-session-naming", title: "v1.44 默认会话命名", scenarioScript: "scripts/verify-v144-local-session-naming-scenario.mjs", providerFixtureUrl: origin + "/v1", designatedAdmin: true, expectedWorkflows: 4 });
  await writeFile(join(result.outputDir, "provider-http-requests.json"), JSON.stringify(requests, null, 2));
} finally { release(); provider.closeAllConnections(); await new Promise((resolve) => provider.close(resolve)); }
process.exit(result.fail > 0 ? 1 : 0);
