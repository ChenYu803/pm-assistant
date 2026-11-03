// v1.44 #03：真实应用 + 随机隔离库 + 本机供应商边界，无真实邮件或模型费用。
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
let count = 0;
// 使用当前应用已核实的 Flash 价格；供应商 usage 与 #07 相同，避免缺失用量留下待核对冻结。
const fixtureModel = "deepseek-v4-flash";
const usage = { prompt_tokens: 1000, prompt_cache_hit_tokens: 400, prompt_cache_miss_tokens: 600, completion_tokens: 100, total_tokens: 1100, completion_tokens_details: { reasoning_tokens: 20 } };
const provider = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/stats") return response.end(JSON.stringify({ count }));
  if (request.url !== "/v1/chat/completions" || request.method !== "POST") return response.writeHead(404).end("{}");
  try {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    if (request.headers.authorization !== "Bearer isolated-provider-fixture" || body.model !== fixtureModel) return response.writeHead(403).end("{}");
    count++;
    const common = { id: "admin-fixture-" + count, model: fixtureModel, created: Math.floor(Date.now() / 1000) };
    // 不记录提示词或凭据，只观察确实到达外部边界的请求总数。
    if (body.stream) {
      response.setHeader("Content-Type", "text/event-stream");
      response.write("data: " + JSON.stringify({ ...common, choices: [{ index: 0, delta: { content: "测试回复已完成。" }, finish_reason: null }] }) + "\n\n");
      response.write("data: " + JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + "\n\n");
      response.end("data: " + JSON.stringify({ ...common, choices: [], usage }) + "\n\ndata: [DONE]\n\n");
    } else response.end(JSON.stringify({ ...common, choices: [{ index: 0, message: { role: "assistant", content: "测试润色已完成。" }, finish_reason: "stop" }], usage }));
  } catch { response.writeHead(400).end("{}"); }
});
await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
process.env.AI_MODE = "replay";
const previousModel = process.env.AI_MODEL;
process.env.AI_MODEL = fixtureModel;
let result;
try {
  result = await runIsolatedReplay({ slug: "admin-controls", title: "管理员账号控制", scenarioScript: "scripts/verify-v144-admin-controls-scenario.mjs", designatedAdmin: true, seedLegacyAuth: true, providerFixtureUrl: "http://127.0.0.1:" + provider.address().port + "/v1", expectedWorkflows: 4 });
  await writeFile(join(result.outputDir, "provider-summary.json"), JSON.stringify({ count, realProvider: false, model: fixtureModel, usage, pricing: "应用内已核实 Flash 价格，仅本机协议替身" }));
} finally { if (previousModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = previousModel; provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); }
process.exit(result.fail > 0 ? 1 : 0);
