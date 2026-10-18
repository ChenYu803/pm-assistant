// 润色仍使用完整结果预览：验证心跳、客户端分块/断流、JSON 兼容及显式应用边界。
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readGenerationResult } from "../src/lib/generation-result-client.ts";
import { createIterationGenerationStream } from "../src/lib/iteration-generation-stream.ts";
import { postMysqlChat } from "../src/lib/mysql-chat.ts";
import { closeMysqlPoolForTests } from "../src/lib/mysql.ts";

export async function verifyProductionPolish({ page, pool, userId, base, output, check }) {
  const encoder = new TextEncoder();
  const resultEvent = (status, body) => `event: result\ndata: ${JSON.stringify({ status, body })}\n\n`;
  const sse = (text, split = false) => {
    const encoded = encoder.encode(text);
    return new Response(new ReadableStream({ start(controller) {
      if (split) { for (const value of encoded) controller.enqueue(new Uint8Array([value])); }
      else controller.enqueue(encoded);
      controller.close();
    } }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
  };
  const split = await readGenerationResult(sse(`event: heartbeat\ndata: {}\n\n${resultEvent(200, { polished: "中文跨 UTF-8 分块正文" })}`, true));
  check("润色客户端支持跨字节中文分块并忽略心跳", split.polished === "中文跨 UTF-8 分块正文");
  for (const [title, response, expected] of [
    ["断流", sse("event: heartbeat\ndata: {}\n\n"), "未完成"],
    ["不完整终态", sse(resultEvent(200, { polished: "正文" }).slice(0, -2)), "未完成"],
    ["SSE 429", sse(resultEvent(429, { error: "今日 AI 体验次数已用完" })), "今日 AI"],
    ["JSON 429", Response.json({ error: "额度错误" }, { status: 429 }), "额度错误"],
    ["无效正文", sse(resultEvent(200, { polished: 5 })), "无效"],
  ]) {
    let message = "";
    try { await readGenerationResult(response); } catch (error) { message = error.message; }
    check(`润色客户端拒绝${title}且保留错误信息`, message.includes(expected));
  }
  check("润色客户端兼容旧 JSON 成功响应", (await readGenerationResult(Response.json({ polished: "旧 JSON 正文" }))).polished === "旧 JSON 正文");
  let finish;
  let aborted = false;
  const heartbeat = createIterationGenerationStream(async (_onContent, signal) => {
    await new Promise((resolve) => { finish = resolve; signal.addEventListener("abort", resolve, { once: true }); });
    aborted = signal.aborted;
    return { status: 200, body: { polished: "完整结果" } };
  }, 10);
  const reader = heartbeat.body.getReader();
  const firstEvent = new TextDecoder().decode((await reader.read()).value);
  check("只有完整润色结果时等待阶段仍输出心跳并禁代理缓冲", firstEvent.includes("event: heartbeat") && heartbeat.headers.get("X-Accel-Buffering") === "no" && heartbeat.headers.get("Cache-Control").includes("no-transform"));
  await reader.cancel(); await new Promise((resolve) => setTimeout(resolve, 0));
  check("润色读取端取消向上游传递中止信号", aborted && typeof finish === "function");

  const projectId = randomUUID(); const recordId = randomUUID(); const fileId = randomUUID();
  const initial = "# 润色验证原文\n\n只在显式保存后修改数据库。";
  await pool.execute("INSERT INTO projects (id,user_id,name) VALUES (?,?,'润色夹具项目')", [projectId, userId]);
  await pool.execute("INSERT INTO work_records (id,project_id,name) VALUES (?,?,'润色工作记录')", [recordId, projectId]);
  await pool.execute("INSERT INTO tabs (id,work_record_id,agent_type,display_name,position) VALUES (?,?,'requirement_analyst','润色夹具',1)", [randomUUID(), recordId]);
  await pool.execute("INSERT INTO project_files (id,project_id,filename,content,version) VALUES (?,?,'润色验证.md',?,1)", [fileId, projectId, initial]);
  const fileRow = async () => JSON.stringify((await pool.query("SELECT * FROM project_files WHERE id = ?", [fileId]))[0]);
  const before = await fileRow();
  const path = `/api/projects/${projectId}/files/${fileId}/polish`;
  const jsonResponse = await page.request.post(`${base}${path}`, { data: { content: initial } });
  const jsonResult = await jsonResponse.json();
  check("真实已登录润色 API 保持 JSON 成功协议", jsonResponse.status() === 200 && typeof jsonResult.polished === "string" && jsonResult.polished.length > 0 && !jsonResponse.headers()["content-type"].includes("text/event-stream"));
  const streamResponse = await page.request.post(`${base}${path}`, { data: { content: initial }, headers: { Accept: "text/event-stream" } });
  const streamResult = await readGenerationResult(new Response(await streamResponse.body(), { status: streamResponse.status(), headers: streamResponse.headers() }));
  check("真实已登录润色 API 可选 SSE 完整终态并禁缓存/代理缓冲", streamResult.polished === jsonResult.polished && streamResponse.headers()["content-type"].includes("text/event-stream") && streamResponse.headers()["x-accel-buffering"] === "no");
  check("JSON/SSE 润色 API 均不隐式写入项目文件", before === await fileRow());

  await page.goto(`${base}/workspace/${recordId}`);
  await page.getByRole("button", { name: /润色验证\.md/ }).click();
  const previewHeading = page.getByRole("heading", { name: "润色验证.md", exact: true });
  await previewHeading.waitFor();
  await previewHeading.locator("xpath=../..").locator('button[title="编辑"]').click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const polishResponse = page.waitForResponse((response) => response.url() === `${base}${path}` && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "AI 润色", exact: true }).click();
  const actualResponse = await polishResponse;
  await dialog.getByRole("button", { name: "应用润色", exact: true }).waitFor();
  check("真实 UI 请求 SSE 并先预览完整正文，编辑器原文保持", actualResponse.request().headers().accept === "text/event-stream" && await dialog.locator("textarea").inputValue() === initial && await dialog.locator("pre").innerText() === jsonResult.polished);
  check("预览润色结果不会写入数据库", before === await fileRow());
  await dialog.getByRole("button", { name: "应用润色", exact: true }).click();
  check("显式应用只改变编辑草稿，仍需保存才落盘", await dialog.locator("textarea").inputValue() === jsonResult.polished && before === await fileRow());
  await page.route(`${base}${path}`, (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: resultEvent(429, { error: "今日 AI 体验次数已用完，请明天再来。" }) }));
  await dialog.getByRole("button", { name: "AI 润色", exact: true }).click();
  await dialog.getByText("今日 AI 体验次数已用完，请明天再来。", { exact: true }).waitFor();
  check("UI 显示 SSE 额度错误并保留草稿/数据库", await dialog.locator("textarea").inputValue() === jsonResult.polished && before === await fileRow() && await dialog.getByRole("button", { name: "应用润色", exact: true }).count() === 0);
  await page.screenshot({ path: join(output, "polish-stream-quota.png"), fullPage: true });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.unroute(`${base}${path}`);
}

export async function verifyProductionLegacy({ page, pool, userId, base, check }) {
  const [tabs] = await pool.query("SELECT t.id FROM tabs t JOIN work_records w ON w.id=t.work_record_id JOIN projects p ON p.id=w.project_id WHERE p.user_id=? AND t.display_name='润色夹具'", [userId]);
  const tabId = tabs[0].id;
  const path = `/api/tabs/${tabId}/chat`;
  const requestId = randomUUID();
  const disconnected = await page.evaluate(async ({ path, requestId }) => {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-pm-verify-stream-delay": "1" }, body: JSON.stringify({ expectedVersion: 0, requestId, content: "旧工作台断线验证" }) });
    const reader = response.body.getReader();
    const decoder = new TextDecoder(); let text = "";
    while (!text.includes('"type":"token"')) {
      const chunk = await reader.read(); if (chunk.done) throw new Error("未收到旧工作台 token");
      text += decoder.decode(chunk.value);
    }
    await reader.cancel();
    return { status: response.status, cache: response.headers.get("Cache-Control"), buffering: response.headers.get("X-Accel-Buffering"), text };
  }, { path, requestId });
  check("旧工作台真实 SSE 输出 token 且禁缓存/代理缓冲", disconnected.status === 200 && disconnected.cache.includes("no-store") && disconnected.cache.includes("no-transform") && disconnected.buffering === "no");
  let interrupted;
  const deadline = Date.now() + 5000;
  do {
    const [rows] = await pool.query("SELECT status,content FROM messages WHERE tab_id=? AND request_id=? AND role='assistant'", [tabId, requestId]);
    interrupted = rows[0];
    if (interrupted?.status !== "generating") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  const [unlocked] = await pool.query("SELECT active_operation_id,version FROM tabs WHERE id=?", [tabId]);
  check("旧工作台 HTTP 断开后持久 interrupted/部分正文并释放操作锁", interrupted?.status === "interrupted" && interrupted.content.length > 0 && unlocked[0].active_operation_id === null);
  const retry = await page.request.post(`${base}${path}`, { data: { expectedVersion: unlocked[0].version, requestId: randomUUID(), content: "断线后继续生成" } });
  check("旧工作台断线后新请求可完成并返回真实终态", retry.status() === 200 && (await retry.text()).includes('"type":"done"'));

  // 只把本测试进程的 15 秒计时器缩至 20ms；执行同一真实数据库/正式函数，服务器源码保持不变。
  const nativeInterval = globalThis.setInterval;
  let requestedHeartbeat = false;
  const controller = new AbortController();
  let response;
  try {
    globalThis.setInterval = (callback, ms, ...args) => { if (ms === 15_000) requestedHeartbeat = true; return nativeInterval(callback, ms === 15_000 ? 20 : ms, ...args); };
    const [current] = await pool.query("SELECT version FROM tabs WHERE id=?", [tabId]);
    const body = { expectedVersion: current[0].version, requestId: randomUUID(), content: "旧工作台心跳验证" };
    response = await postMysqlChat({ request: new Request(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-pm-verify-stream-delay": "1" }, body: JSON.stringify(body), signal: controller.signal }), userId, tabId, body });
  } finally { globalThis.setInterval = nativeInterval; }
  const reader = response.body.getReader(); let text = "";
  try {
    while (!text.includes('"type":"heartbeat"')) {
      const chunk = await reader.read(); if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    check("旧工作台正式函数注册 15 秒心跳并输出兼容 data/type 协议（测试时钟加速）", requestedHeartbeat && text.includes('data: {"type":"heartbeat"}'));
  } finally {
    controller.abort();
    await reader.cancel();
    // ReadableStream 取消早于 async start 内的数据库收口完成，先等待终态再关闭本测试进程连接池。
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [state] = await pool.query("SELECT active_operation_id FROM tabs WHERE id=?", [tabId]);
      if (state[0].active_operation_id === null) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const [finished] = await pool.query("SELECT active_operation_id FROM tabs WHERE id=?", [tabId]);
    check("旧工作台请求中止后完成数据库收口再结束测试连接", finished[0].active_operation_id === null);
    await closeMysqlPoolForTests();
  }
}
