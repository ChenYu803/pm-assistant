// live 分支接线专项：仅监听本机模拟 HTTP 服务，不连接真实供应商。
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createAIStream, createAICompletion } from "../src/lib/ai.ts";
import { AccountAccessError } from "../src/lib/account-controls.ts";
import { AIQuotaError } from "../src/lib/mysql-ai-budget.ts";
import { getMysqlPool, closeMysqlPoolForTests } from "../src/lib/mysql.ts";

if (process.env.AI_MODE !== "live" || !/^v142_backup_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE ?? "")) throw new Error("仅允许本次隔离库与本机模拟 live 分支");
let pass = 0; let fail = 0; let requests = 0; let failNext = false;
const seededUserIds = new Set();
const userId = randomUUID();
const options = { userId, messages: [{ role: "user", content: "隔离模拟输入" }], maxTokens: 20, timeoutMs: 3000 };
function check(name, okay) { if (!okay) throw new Error(name); pass++; }
const server = createServer(async (request, response) => {
  requests++;
  let body = ""; for await (const chunk of request) body += chunk;
  const input = JSON.parse(body);
  if (failNext) { failNext = false; response.writeHead(500, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: "模拟供应商失败", type: "server_error" } })); return; }
  if (input.stream) {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ id: "isolated", object: "chat.completion.chunk", created: 1, model: "isolated", choices: [{ index: 0, delta: { content: "模拟流正文" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`);
  } else {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "isolated", object: "chat.completion", created: 1, model: "isolated", choices: [{ index: 0, message: { role: "assistant", content: "模拟完整正文" }, finish_reason: "stop" }] }));
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
process.env.AI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
process.env.AI_API_KEY = "isolated-local-http-only";
process.env.AI_DAILY_USER_LIMIT = "2";
process.env.AI_DAILY_SITE_LIMIT = "100";
async function seedActiveUser(id) {
  await getMysqlPool().execute("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)", [id, id + "@test.local", "isolated-unused-hash"]);
  seededUserIds.add(id);
}
try {
  await seedActiveUser(userId);
  for (const generate of [createAICompletion, createAIStream]) {
    let denied = false;
    try { await generate({ ...options, userId: undefined }); } catch (error) { denied = error instanceof AccountAccessError; }
    check("缺失账号的 live 请求在供应商之前拒绝", denied && requests === 0);
  }
  check("live Completion 经真实 SDK 调用本机 HTTP", await createAICompletion(options) === "模拟完整正文" && requests === 1);
  let streamed = "";
  for await (const chunk of await createAIStream(options)) streamed += chunk.choices[0].delta.content ?? "";
  check("live Stream 经真实 SDK 调用本机 HTTP", streamed === "模拟流正文" && requests === 2);
  for (const generate of [createAICompletion, createAIStream]) {
    let denied = false;
    try { await generate(options); } catch (error) { denied = error instanceof AIQuotaError; }
    check("Stream/Completion 共享限额且被拒请求不访问供应商", denied && requests === 2);
  }
  failNext = true;
  const failedUser = randomUUID(); await seedActiveUser(failedUser); let failed = false;
  try { await createAICompletion({ ...options, userId: failedUser }); } catch { failed = true; }
  check("HTTP 500 不被 SDK 隐式重试", failed && requests === 3);
  const [failedUsage] = await getMysqlPool().query("SELECT request_count FROM ai_daily_usage WHERE subject = ?", [failedUser]);
  check("已经发出的失败供应商请求仍占用一次", failedUsage[0]?.request_count === 1);
  const randomUser = randomUUID(); await seedActiveUser(randomUser);
  const concurrent = await Promise.allSettled(Array.from({ length: 8 }, () => createAICompletion({ ...options, userId: randomUser })));
  check("live 入口八并发只有两次真正到达供应商", concurrent.filter((x) => x.status === "fulfilled").length === 2 && concurrent.filter((x) => x.status === "rejected").every((x) => x.reason instanceof AIQuotaError) && requests === 5);
} catch (error) {
  fail++; console.error(`❌ 模拟 live 入口：${error.message}`);
} finally {
  server.close(); await once(server, "close");
  try {
    // 只删除本子专项成功创建的账号，保留父专项的备份账号与严格恢复断言。
    if (seededUserIds.size > 0) {
      const ids = [...seededUserIds];
      const [removed] = await getMysqlPool().execute(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(", ")})`, ids);
      if (removed.affectedRows !== ids.length) throw new Error("本子专项测试账号未全部清理");
      console.log(`已清理本子专项创建的 ${ids.length} 个测试账号`);
    }
  } catch (error) {
    fail++; console.error(`❌ 模拟 live 账号清理：${error.message}`);
  } finally {
    await closeMysqlPoolForTests();
  }
}
console.log(`AI_BOUNDARY_SUMMARY=${JSON.stringify({ pass, fail, requests, externalRequests: 0 })}`);
process.exit(fail > 0 ? 1 : 0);
