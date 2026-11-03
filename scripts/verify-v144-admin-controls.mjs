// v1.44 #03：真实应用 + 随机隔离库 + 本机供应商边界，无真实邮件或模型费用。
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
let count = 0;
const provider = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/stats") return response.end(JSON.stringify({ count }));
  if (request.url !== "/v1/chat/completions" || request.method !== "POST") return response.writeHead(404).end("{}");
  try {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); count++;
    // 不记录提示词或凭据，只观察确实到达外部边界的请求总数。
    if (body.stream) { response.setHeader("Content-Type", "text/event-stream"); response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: "测试回复已完成。" } }] }) + '\n\ndata: [DONE]\n\n'); }
    else response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "测试润色已完成。" } }] }));
  } catch { response.writeHead(400).end("{}"); }
});
await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
process.env.AI_MODE = "replay";
let result;
try {
  result = await runIsolatedReplay({ slug: "admin-controls", title: "管理员账号控制", scenarioScript: "scripts/verify-v144-admin-controls-scenario.mjs", designatedAdmin: true, seedLegacyAuth: true, providerFixtureUrl: "http://127.0.0.1:" + provider.address().port + "/v1", expectedWorkflows: 4 });
  await writeFile(join(result.outputDir, "provider-summary.json"), JSON.stringify({ count, realProvider: false }));
} finally { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); }
process.exit(result.fail > 0 ? 1 : 0);
