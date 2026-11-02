// v1.44 #01：独立空库与本机 HTTP 模型替身，不访问真实供应商。
import { createServer } from "node:http";
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
    const finish = () => {
      if (response.destroyed) return;
      if (data.stream) {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: "已收到，我们继续讨论。" } }] }) + '\n\ndata: [DONE]\n\n');
      } else {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "旧模型命名不应触发" } }] }));
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
  result = await runIsolatedReplay({ slug: "local-session-naming", title: "v1.44 默认会话命名", scenarioScript: "scripts/verify-v144-local-session-naming-scenario.mjs", providerFixtureUrl: origin + "/v1", expectedWorkflows: 4 });
  await writeFile(join(result.outputDir, "provider-http-requests.json"), JSON.stringify(requests, null, 2));
} finally { release(); provider.closeAllConnections(); await new Promise((resolve) => provider.close(resolve)); }
process.exit(result.fail > 0 ? 1 : 0);
