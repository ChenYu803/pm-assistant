// v1.42：验证工作台流式回复、断线/停止事实与旧 JSON 响应兼容。
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createIterationGenerationStream } from "../src/lib/iteration-generation-stream.ts";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

const base = process.env.BASE_URL;
const output = process.env.V141_REPLAY_OUTPUT_DIR;
const workflows = [];
let pass = 0;
let fail = 0;
function check(name, okay, detail = "") {
  if (okay) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.error(`❌ ${name}${detail ? `：${detail}` : ""}`); }
}
async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init);
    return { status: response.status, body: await response.json() };
  }, { path, init });
}
const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function disconnectGeneration(page, path, body, method = "POST") {
  await page.evaluate(async ({ path, body, method }) => {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json", Accept: "text/event-stream", "x-pm-verify-stream-delay": "1" }, body: JSON.stringify(body) });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("event: token")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("断线测试未收到 token");
      text += decoder.decode(chunk.value);
    }
    await reader.cancel();
  }, { path, body, method });
}

if (!base || !output || process.env.AI_MODE !== "replay") throw new Error("必须由隔离 replay launcher 提供 BASE_URL、输出目录与 AI_MODE=replay");
await assertPlaywrightAvailable(chromium, { channel: "msedge" });

// 人为延迟首个内容，确保浏览器可在正文到达前收到心跳事件。
const heartbeatResponse = createIterationGenerationStream(async (onContent) => {
  await new Promise((resolve) => setTimeout(resolve, 70));
  onContent("心跳后正文");
  return { status: 201, body: { ok: true } };
}, 20);
const heartbeatReader = heartbeatResponse.body.getReader();
const decoder = new TextDecoder();
let heartbeatText = "";
while (!heartbeatText.includes("event: token")) {
  const chunk = await heartbeatReader.read();
  if (chunk.done) break;
  heartbeatText += decoder.decode(chunk.value);
}
check("正文生成前先发出心跳，且响应关闭缓存与代理缓冲", heartbeatText.includes("event: heartbeat") && heartbeatText.includes("event: token") && heartbeatResponse.headers.get("Cache-Control")?.includes("no-transform") && heartbeatResponse.headers.get("X-Accel-Buffering") === "no");
await heartbeatReader.cancel();
workflows.push("heartbeat-before-first-token");
let disconnectedSignalAborted = false;
const disconnectedResponse = createIterationGenerationStream(async (_onContent, signal) => {
  await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
  disconnectedSignalAborted = signal.aborted;
  return { status: 409, body: { error: "生成已停止" } };
}, 20);
const disconnectedReader = disconnectedResponse.body.getReader();
await disconnectedReader.read();
await disconnectedReader.cancel();
await new Promise((resolve) => setTimeout(resolve, 0));
check("浏览器断开响应会中止上游生成信号", disconnectedSignalAborted);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(45_000);
page.setDefaultNavigationTimeout(45_000);
try {
  await page.goto(`${base}/register`);
  await page.fill("#email", `verify-v142-stream-${Date.now()}@test.local`);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");

  const project = await api(page, "/api/projects", json({ name: "生成流式验证" }));
  const iteration = await api(page, `/api/projects/${project.body.id}/iterations`, json({ displayName: "第一轮", goal: null }));
  const session = await api(page, `/api/iterations/${iteration.body.id}/stages/analysis/sessions`, { method: "POST" });
  check("独立创建项目、迭代与会话", project.status === 201 && iteration.status === 201 && session.status === 201);
  workflows.push("workbench-streamed-generation");

  const messagesPath = `/api/iterations/${iteration.body.id}/stages/analysis/sessions/${session.body.session.id}/messages`;
  const workbenchPath = `/projects/${project.body.id}/iterations/${iteration.body.id}`;
  const absoluteMessagesPath = `${base}${messagesPath}`;
  await page.route(absoluteMessagesPath, (route) => route.continue(route.request().method() === "POST" ? {
    headers: { ...route.request().headers(), "x-pm-verify-stream-delay": "1" },
  } : undefined));
  await page.goto(`${base}${workbenchPath}`);
  const input = page.getByRole("textbox", { name: "输入消息" });
  await input.fill("验证逐步生成与停止时保留部分内容");
  await page.getByRole("button", { name: "发送消息" }).click();
  const liveAssistant = page.locator(".workbench-message.assistant").last();
  await liveAssistant.locator(".message-content").waitFor();
  await page.waitForFunction(() => {
    const message = document.querySelector(".workbench-message.assistant:last-of-type .message-content");
    return Boolean(message?.textContent?.length);
  });
  check("Agent 正文在请求完成前已显示", (await liveAssistant.locator(".message-content").innerText()).length > 0 && (await liveAssistant.locator(".message-label").innerText()).includes("生成中"));
  let partial;
  const partialDeadline = Date.now() + 5_000;
  do {
    const liveMessages = await api(page, messagesPath);
    partial = [...(liveMessages.body.messages ?? [])].reverse().find((message) => message.role === "assistant");
    if (partial?.status === "generating" && partial.content.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < partialDeadline);
  check("生成中的部分正文已持久化且仍标记 generating", partial?.status === "generating" && partial.content.length > 0, JSON.stringify(partial && { status: partial.status, length: partial.content.length, errorMessage: partial.errorMessage }));
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await page.waitForFunction((previousSessionId) => {
    const selected = document.querySelector('.session-row[aria-current="page"]');
    return selected?.getAttribute("data-session-id") !== previousSessionId && selected?.querySelector("strong")?.textContent === "新会话"
      && Boolean(document.querySelector(".session-start")) && !document.querySelector(".session-loading");
  }, session.body.session.id);
  check("生成时切到另一会话不混入旧回复", await page.locator(".workbench-message.assistant").count() === 0);
  await page.locator(`.session-row[data-session-id="${session.body.session.id}"]`).click();
  await liveAssistant.locator(".message-content").waitFor();
  check("切回生成会话只显示一条回复并恢复完整部分正文", await page.locator(".workbench-message.assistant").count() === 1 && (await liveAssistant.locator(".message-content").innerText()).length > 0);
  await page.getByRole("button", { name: "停止生成" }).click();
  await page.getByText(/已停止/).last().waitFor();
  const stoppedMessages = await api(page, messagesPath);
  const stopped = [...(stoppedMessages.body.messages ?? [])].reverse().find((message) => message.role === "assistant");
  check("停止后保留部分正文并标记失败/已停止", stopped?.status === "failed" && stopped.errorMessage === "生成已停止" && stopped.content.length > 0);
  await page.reload();
  await page.getByText(/已停止/).last().waitFor();
  check("刷新后仍恢复停止终态和部分正文", (await liveAssistant.locator(".message-content").innerText()).length > 0);
  await page.unroute(absoluteMessagesPath);

  await input.fill("验证 SSE 成功终态");
  await page.getByRole("button", { name: "发送消息" }).click();
  await page.waitForFunction(async (path) => {
    const response = await fetch(path);
    const body = await response.json();
    return body.messages?.at(-1)?.role === "assistant" && body.messages.at(-1).status === "completed";
  }, messagesPath);
  const successful = await api(page, messagesPath);
  check("SSE 正常结束后数据库保存完整 completed 正文", successful.body.messages.at(-1).status === "completed" && successful.body.messages.at(-1).content.length > 0, JSON.stringify(successful.body.messages.map((message) => ({ role: message.role, status: message.status, length: message.content.length, errorMessage: message.errorMessage }))));
  const originalAssistantId = successful.body.messages.at(-1).id;
  workflows.push("stream-completion-and-persistence");

  // 真正断开 HTTP 响应，验证 Next 路由到数据库的取消链路，保持旧成功回复与用户原文。
  for (const mutation of [{ regenerateMessageId: originalAssistantId }, { editMessageId: successful.body.messages.at(-2).id, content: "断线时不提交的编辑" }]) {
    const mutationPath = mutation.editMessageId ? `/api/iterations/${iteration.body.id}/sessions/${session.body.session.id}/messages/${mutation.editMessageId}` : messagesPath;
    await disconnectGeneration(page, mutationPath, mutation, mutation.editMessageId ? "PATCH" : "POST");
    await page.waitForFunction(async (path) => {
      const body = await (await fetch(path)).json();
      return !body.messages.some((message) => message.status === "generating");
    }, messagesPath);
    const afterDisconnect = await api(page, messagesPath);
    check(`${mutation.editMessageId ? "编辑" : "重新生成"}断线后清理临时消息并保留原成功事实`, JSON.stringify(afterDisconnect.body.messages) === JSON.stringify(successful.body.messages));
  }

  await page.getByRole("button", { name: "重新生成" }).last().click();
  await page.waitForFunction(async ({ path, previousId }) => {
    const body = await (await fetch(path)).json();
    const latest = body.messages?.at(-1);
    return latest?.role === "assistant" && latest.status === "completed" && latest.id !== previousId;
  }, { path: messagesPath, previousId: originalAssistantId });
  check("重新生成也经流式协议完成并以新消息替换旧回复", true);
  workflows.push("stream-regeneration");

  await page.getByRole("button", { name: "修改并重新发送" }).last().click();
  const editBox = page.getByRole("textbox", { name: "修改这条消息" });
  await editBox.fill("验证编辑后仍逐步生成");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(async ({ path, expected }) => {
    const body = await (await fetch(path)).json();
    const latest = body.messages?.at(-1);
    return body.messages?.some((message) => message.role === "user" && message.content === expected)
      && latest?.role === "assistant" && latest.status === "completed";
  }, { path: messagesPath, expected: "验证编辑后仍逐步生成" });
  const editedMessages = await api(page, messagesPath);
  await page.waitForFunction((expectedCount) => document.querySelectorAll(".workbench-message.assistant").length === expectedCount
    && ![...document.querySelectorAll(".workbench-message.assistant .message-label")].some((label) => label.textContent.includes("生成中")),
  editedMessages.body.messages.filter((message) => message.role === "assistant").length);
  check("编辑后重生成使用流式协议且界面无重复回复", true);
  workflows.push("stream-edited-regeneration");

  const legacy = await api(page, messagesPath, json({ content: "验证旧 JSON 客户端兼容" }));
  check("未请求 SSE 的旧 JSON 调用仍返回原状态与消息结构", legacy.status === 200 && Array.isArray(legacy.body.messages) && legacy.body.messages.at(-1).status === "completed");
  workflows.push("legacy-json-compatibility");
  await disconnectGeneration(page, messagesPath, { content: "断线时保留的普通消息" });
  await page.waitForFunction(async (path) => {
    const body = await (await fetch(path)).json();
    return body.messages?.at(-1)?.status === "failed";
  }, messagesPath);
  const disconnectedMessages = await api(page, messagesPath);
  const disconnectedAssistant = disconnectedMessages.body.messages.at(-1);
  check("普通发送断线后保留部分正文和已停止终态", disconnectedAssistant?.errorMessage === "生成已停止" && disconnectedAssistant.content.length > 0
    && JSON.stringify(disconnectedMessages.body.messages.slice(0, -2)) === JSON.stringify(legacy.body.messages)
    && disconnectedMessages.body.messages.at(-2)?.content === "断线时保留的普通消息");
} catch (error) {
  check("浏览器连续回放完整执行", false, error instanceof Error ? error.stack : String(error));
} finally {
  await context.close();
  await browser.close();
}

await mkdir(output, { recursive: true });
await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, aiMode: "replay", workflows }, null, 2));
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
