// v1.42：验证工作台流式回复、断线/停止事实与旧 JSON 响应兼容。
import { chromium } from "playwright-core";
import { latestEmailCode } from "./verify-email-fixture.mjs";
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
let disconnectSequence = 0;
const messageSnapshot = (messages) => messages.map((message) => ({
  id: message.id, role: message.role, status: message.status, length: message.content?.length,
  createdAt: message.createdAt, errorMessage: message.errorMessage,
  candidateId: message.candidate?.id, taskCandidateId: message.taskCandidate?.id,
}));
// 本机 Playwright 的 waitForFunction 不轮询 async 回调，HTTP 条件由 Node 显式等待。
async function waitForMessages(page, path, predicate, label) {
  const deadline = Date.now() + 45_000;
  let messages;
  do {
    const response = await api(page, path);
    if (response.status !== 200 || !Array.isArray(response.body.messages)) throw new Error(label + "：消息读取失败，HTTP " + response.status);
    messages = response.body.messages;
    if (predicate(messages)) return messages;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(label + "：45 秒内未达到条件；" + JSON.stringify(messageSnapshot(messages)));
}
async function disconnectGeneration(page, path, body, method = "POST") {
  const evidenceName = "disconnect-" + (++disconnectSequence) + "-transport.json";
  const transport = await page.evaluate(async ({ path, body, method }) => {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body) });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let pending = "";
    let result;
    let firstToken;
    try {
      while (!firstToken) {
        const chunk = await reader.read();
        const part = decoder.decode(chunk.value, { stream: !chunk.done });
        text += part;
        pending += part;
        let boundary;
        while ((boundary = pending.indexOf("\n\n")) >= 0) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          const lines = frame.split("\n");
          const event = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
          const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (!data) continue;
          const payload = JSON.parse(data);
          if (event === "result") result = payload;
          if (event === "token" && !firstToken) firstToken = { messageId: payload.messageId, length: payload.content?.length };
        }
        if (chunk.done) break;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return { status: response.status, contentType: response.headers.get("Content-Type"), firstToken, result, ...(!firstToken ? { sse: text } : {}) };
  }, { path, body, method });
  await mkdir(output, { recursive: true });
  await writeFile(join(output, evidenceName), JSON.stringify({ path, method, transport }, null, 2));
  if (!transport.firstToken?.messageId) throw new Error("断线测试未取得首 token 身份；HTTP " + transport.status + "；SSE result.status=" + transport.result?.status + "；完整响应见 " + evidenceName);
  return { ...transport, evidenceName };
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
let finishDisconnected;
let disconnectedSignal;
let disconnectedTask;
let disconnectedCompleted = false;
let disconnectedEnded = false;
const disconnectedResponse = createIterationGenerationStream((_onContent, signal) => {
  disconnectedSignal = signal;
  disconnectedTask = (async () => {
    await new Promise((resolve) => { finishDisconnected = resolve; });
    disconnectedCompleted = true;
    return { status: 200, body: { ok: true } };
  })();
  return disconnectedTask;
}, 20);
const disconnectedReader = disconnectedResponse.body.getReader();
try {
  await disconnectedReader.read();
  await disconnectedReader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 0));
  check("浏览器断开响应不触发上游中止且后台任务继续等待", !disconnectedSignal.aborted && !disconnectedCompleted && typeof finishDisconnected === "function");
} finally {
  // 网页断开只结束传输；显式释放夹具 promise，并确认任务和读取锁均已收口。
  finishDisconnected?.();
  await disconnectedTask;
  await disconnectedReader.cancel();
  disconnectedEnded = (await disconnectedReader.read()).done;
  await disconnectedReader.closed;
  disconnectedReader.releaseLock();
}
check("断开后后台任务完成且响应流无残留", disconnectedCompleted && !disconnectedSignal.aborted && disconnectedEnded && !disconnectedResponse.body.locked);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(45_000);
page.setDefaultNavigationTimeout(120_000);
try {
  await page.goto(`${base}/register`);
  const email = `verify-v142-stream-${Date.now()}@test.local`;
  await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  const [emailCodeResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/email-code" && response.request().method() === "POST"),
    page.getByRole("button", { name: "获取验证码", exact: true }).click(),
  ]);
  if (emailCodeResponse.status() !== 200) throw new Error("浏览器注册发码失败，HTTP " + emailCodeResponse.status());
  await page.getByRole("status").filter({ hasText: /验证码已发送/ }).waitFor();
  await page.fill("#emailCode", await latestEmailCode(email));
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
  await waitForMessages(page, messagesPath, messages => messages.at(-1)?.role === "assistant" && messages.at(-1).status === "completed", "普通 SSE 完成");
  const successful = await api(page, messagesPath);
  check("SSE 正常结束后数据库保存完整 completed 正文", successful.body.messages.at(-1).status === "completed" && successful.body.messages.at(-1).content.length > 0, JSON.stringify(successful.body.messages.map((message) => ({ role: message.role, status: message.status, length: message.content.length, errorMessage: message.errorMessage }))));
  workflows.push("stream-completion-and-persistence");

  // HTTP 断开只结束传输；重新生成和编辑继续完成，并提交对应结果。
  for (const editing of [false, true]) {
    const beforeDisconnect = (await api(page, messagesPath)).body.messages;
    const previousAssistant = beforeDisconnect.at(-1);
    const previousUser = beforeDisconnect.at(-2);
    const mutation = editing
      ? { editMessageId: previousUser.id, content: "断线后继续完成的编辑" }
      : { regenerateMessageId: previousAssistant.id };
    const mutationPath = editing ? `/api/iterations/${iteration.body.id}/sessions/${session.body.session.id}/messages/${mutation.editMessageId}` : messagesPath;
    const label = editing ? "编辑" : "重新生成";
    const transport = await disconnectGeneration(page, mutationPath, mutation, editing ? "PATCH" : "POST");
    const messageId = transport.firstToken.messageId;
    const evidencePath = join(output, editing ? "disconnect-edit-messages.json" : "disconnect-regenerate-messages.json");
    await writeFile(evidencePath, JSON.stringify({ transport, before: beforeDisconnect, beforeSnapshot: messageSnapshot(beforeDisconnect) }, null, 2));
    try {
      await waitForMessages(page, messagesPath, messages => {
        const reply = messages.find(message => message.id === messageId);
        return reply && reply.status !== "generating";
      }, label + " token 对应消息终态");
    } catch (error) {
      const pending = (await api(page, messagesPath)).body.messages;
      await writeFile(evidencePath, JSON.stringify({ transport, before: beforeDisconnect, after: pending, beforeSnapshot: messageSnapshot(beforeDisconnect), afterSnapshot: messageSnapshot(pending) }, null, 2));
      throw error;
    }
    const afterDisconnect = (await api(page, messagesPath)).body.messages;
    const assistant = afterDisconnect.find(message => message.id === messageId);
    const historyLength = editing ? -2 : -1;
    const conditions = {
      httpOkay: transport.status === 200,
      countUnchanged: afterDisconnect.length === beforeDisconnect.length,
      correlatedNewAssistant: assistant?.role === "assistant" && assistant.id !== previousAssistant.id && afterDisconnect.at(-1)?.id === messageId,
      completedWithContent: assistant?.status === "completed" && assistant.content.length > 0 && !assistant.errorMessage,
      historyUnchanged: JSON.stringify(afterDisconnect.slice(0, historyLength)) === JSON.stringify(beforeDisconnect.slice(0, historyLength)),
      editedUserCommitted: !editing || (afterDisconnect.at(-2)?.id === previousUser.id && afterDisconnect.at(-2)?.content === mutation.content),
    };
    const detail = { messageId, conditions, before: messageSnapshot(beforeDisconnect), after: messageSnapshot(afterDisconnect) };
    await writeFile(evidencePath, JSON.stringify({ transport, conditions, before: beforeDisconnect, after: afterDisconnect, snapshots: detail }, null, 2));
    check(label + "断线后完成并持久新正文、保留更早历史", Object.values(conditions).every(Boolean), JSON.stringify(detail));
  }
  const beforeUiRegeneration = (await api(page, messagesPath)).body.messages.at(-1).id;
  // 外部 HTTP 更新了历史；刷新并等到最新编辑正文可见，使 UI 使用本轮持久消息 ID。
  await page.reload();
  await page.locator(".workbench-message.user .message-content").last().filter({ hasText: /^断线后继续完成的编辑$/ }).waitFor();

  await page.getByRole("button", { name: "重新生成" }).last().click();
  await waitForMessages(page, messagesPath, messages => {
    const latest = messages.at(-1);
    return latest?.role === "assistant" && latest.status === "completed" && latest.id !== beforeUiRegeneration;
  }, "UI 重新生成完成");
  check("重新生成也经流式协议完成并以新消息替换旧回复", true);
  workflows.push("stream-regeneration");

  await page.getByRole("button", { name: "修改并重新发送" }).last().click();
  const editBox = page.getByRole("textbox", { name: "修改这条消息" });
  await editBox.fill("验证编辑后仍逐步生成");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await waitForMessages(page, messagesPath, messages => {
    const latest = messages.at(-1);
    return messages.some(message => message.role === "user" && message.content === "验证编辑后仍逐步生成")
      && latest?.role === "assistant" && latest.status === "completed";
  }, "UI 编辑后生成完成");
  const editedMessages = await api(page, messagesPath);
  await page.waitForFunction((expectedCount) => document.querySelectorAll(".workbench-message.assistant").length === expectedCount
    && ![...document.querySelectorAll(".workbench-message.assistant .message-label")].some((label) => label.textContent.includes("生成中")),
  editedMessages.body.messages.filter((message) => message.role === "assistant").length);
  check("编辑后重生成使用流式协议且界面无重复回复", true);
  workflows.push("stream-edited-regeneration");

  const legacy = await api(page, messagesPath, json({ content: "验证旧 JSON 客户端兼容" }));
  check("未请求 SSE 的旧 JSON 调用仍返回原状态与消息结构", legacy.status === 200 && Array.isArray(legacy.body.messages) && legacy.body.messages.at(-1).status === "completed");
  workflows.push("legacy-json-compatibility");
  const ordinaryTransport = await disconnectGeneration(page, messagesPath, { content: "断线时保留的普通消息" });
  await waitForMessages(page, messagesPath, messages => {
    const reply = messages.find(message => message.id === ordinaryTransport.firstToken.messageId);
    return reply && reply.status !== "generating";
  }, "普通断开发送 token 对应消息终态");
  const disconnectedMessages = await api(page, messagesPath);
  const disconnectedAssistant = disconnectedMessages.body.messages.find(message => message.id === ordinaryTransport.firstToken.messageId);
  check("普通发送断线后持久 completed 正文并保留此前历史", disconnectedAssistant?.status === "completed" && !disconnectedAssistant.errorMessage && disconnectedAssistant.content.length > 0
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
