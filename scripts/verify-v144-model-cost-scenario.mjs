// v1.44 #06：只通过正式 HTTP / 页面观察；不读写内部计量表，不调用真实 LLM。
import { chromium, request } from "playwright-core";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { requestRegistrationCode } from "./verify-email-fixture.mjs";

const base = process.env.BASE_URL, output = process.env.V141_REPLAY_OUTPUT_DIR;
const api = "/api/admin/model-requests", pagePath = "/admin/model-requests";
const password = "model-cost-12345", clients = [], workflows = [], assertions = [], diagnostics = [], cases = [], observations = [];
const privateSamples = ["用户对话正文保护样本", "项目文件正文保护样本", "供应商正文保护样本", "供应商异常正文保护样本", "isolated-provider-fixture"];
const expectedUsage = { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, prompt_cache_hit_tokens: 400, prompt_cache_miss_tokens: 600, reasoning_tokens: 20 };
let pass = 0, fail = 0, browser, admin, actor, initialDone, project, polishPath;
function check(name, okay, actual) {
  const success = Boolean(okay); assertions.push({ name, okay: success, ...(!success && actual !== undefined ? { actual } : {}) });
  console.log((success ? "✅ " : "❌ ") + name); if (success) pass++; else fail++; return success;
}
function must(name, okay) { if (!check(name, okay)) { const error = Error(name); error.counted = true; throw error; } }
async function section(name, action) {
  const before = fail;
  try { await action(); } catch (error) { if (!error.counted) check(name + "：" + String(error.message).split("\n")[0], false); }
  if (before === fail) workflows.push(name);
}
async function save() { await writeFile(join(output, "ledger-diagnostic.json"), JSON.stringify({ fixture: true, live: false, diagnostics, cases, observations }, null, 2)); }
function safeRow(row) {
  if (!row) return null;
  // 白名单保留诊断所需元数据；永远不将消息、原始异常和文件正文写入 ledger 摘要。
  return Object.fromEntries(["id", "userId", "purpose", "projectId", "sessionId", "fileId", "requestedModel", "maxOutputTokens", "transport", "actualModel", "providerId", "upstreamRequestId", "startedAt", "endedAt", "status", "finishReason", "errorCode", "usageStatus", "usage", "price", "costCny", "costReason", "websiteBorne"].map(key => [key, row[key]]));
}
async function snapshot(phase, value) {
  diagnostics.push({ phase, observedAt: new Date().toISOString(), total: value.total, page: value.page, pageSize: value.pageSize, summary: value.summary, requests: value.requests.map(safeRow) });
  await save();
}
async function client() { const http = await request.newContext({ baseURL: base, timeout: 30_000 }); clients.push(http); return http; }
async function json(http, path, data) {
  const response = data === undefined ? await http.get(path) : await http.post(path, { data });
  if (!response.ok()) throw Error("正式入口 HTTP " + response.status() + " " + path);
  return response.json();
}
async function register(http, email) {
  const response = await http.post("/api/auth/register", { data: { email, password, code: await requestRegistrationCode(http, email) } });
  must("注册隔离账号", response.status() === 201); return response.json();
}
async function login(http, email) {
  const csrfToken = (await json(http, "/api/auth/csrf")).csrfToken;
  await http.post("/api/auth/callback/credentials", { form: { email, password, csrfToken, callbackUrl: base + "/projects" }, headers: { "X-Auth-Return-Redirect": "1" } });
  return (await json(http, "/api/auth/session"))?.user;
}
async function list(query = {}) { return json(admin, api + "?" + new URLSearchParams(query)); }
async function allRows(query = {}) {
  const first = await list(query), rows = [...first.requests];
  for (let page = 2; page <= Math.ceil(first.total / first.pageSize); page++) rows.push(...(await list({ ...query, page: String(page) })).requests);
  return { ...first, requests: rows };
}
async function fixture(path, data) {
  const response = await fetch(new URL(path, process.env.V144_PROVIDER_FIXTURE_URL), { method: data ? "POST" : "GET", ...(data ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error("供应商替身控制失败 HTTP " + response.status); return response.json();
}
async function poll(read, predicate, timeout = 5000) {
  const until = Date.now() + timeout;
  let value;
  do { value = await read(); if (predicate(value)) return value; await delay(100); } while (Date.now() < until);
  return value;
}
function events(text) {
  return text.split(/\r?\n\r?\n/).map(frame => frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n")).filter(Boolean).map(data => JSON.parse(data));
}
async function newTab() {
  const record = await json(actor, "/api/projects/" + project.id + "/work-records", { name: "隔离成本样本" });
  return (await json(actor, "/api/work-records/" + record.id + "/tabs", { agent_type: "requirement_analyst" })).tab;
}
async function ledgerAfter(name, match) {
  const first = await list({ q: actor.userId }); await snapshot(name + ":immediate", first);
  const final = await poll(() => list({ q: actor.userId }), value => value.requests.some(row => match(row) && row.status !== "running"));
  await snapshot(name + ":terminal", final);
  const row = final.requests.find(match);
  check(name + "请求持久化且在有界轮询内落终态", row && row.status !== "running", safeRow(row)); return row;
}
function units(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,8})?$/.test(value)) throw Error("金额不是人民币八位精度字符串");
  const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
}
function priceOracle(peak) { return { inputHitPerMillion: peak ? "0.04" : "0.02", inputMissPerMillion: peak ? "2" : "1", outputPerMillion: peak ? "8" : "4" }; }
function calculatedCost(price) { return (400n * units(price.inputHitPerMillion) + 600n * units(price.inputMissPerMillion) + 100n * units(price.outputPerMillion)) / 1000000n; }
function assertKnown(name, row, status = "completed") {
  if (!row) return;
  const price = row.price?.start, expectedPrice = priceOracle(price?.peak === true);
  check(name + "状态与可靠用量", row.status === status && row.usageStatus === "reliable", safeRow(row));
  check(name + "缓存、输出和推理用量准确（推理已包含在输出中）", Object.entries(expectedUsage).every(([key, value]) => row.usage?.[key] === value), row.usage);
  check(name + "隔离价格有标识且不冒充官方 live", row.price?.fixture === true && row.price?.official === false);
  check(name + "保存适用价格和可重算依据", price && typeof price.peak === "boolean" && price.currency === "CNY" && !!price.version && !!price.source && !!price.verifiedAt && Object.entries(expectedPrice).every(([key, value]) => price[key] === value) && row.price?.end?.peak === price.peak);
  check(name + "含缓存人民币成本精确且不重复计推理", typeof row.costCny === "string" && units(row.costCny) === calculatedCost(expectedPrice) && row.costReason === "confirmed", row.costCny);
  check(name + "模型、供应商标识、起止时间可追溯", row.actualModel === "deepseek-v4-flash" && !!row.requestedModel && !!row.providerId && !!row.upstreamRequestId && Number.isFinite(Date.parse(row.startedAt)) && Date.parse(row.endedAt) >= Date.parse(row.startedAt));
  observations.push({ name, ledgerId: row.id, priceWindow: price?.peak ? "peak" : "off-peak", costCny: row.costCny });
}
function assertUnknown(name, row, status = "completed") {
  if (!row) return;
  check(name + "保留实际状态且成本待确认", row.status === status && row.usageStatus === "pending" && row.costCny === null && row.costReason === "usage_unconfirmed", safeRow(row));
}
async function chatCase(mode, expected = "known", status = "completed") {
  const tab = await newTab(), plan = await fixture("/control", { mode }), began = Date.now();
  const response = await actor.post("/api/tabs/" + tab.id + "/chat", { data: { content: "用户对话正文保护样本：" + mode, expectedVersion: tab.version, requestId: randomUUID() } });
  const frames = events(await response.text()), done = frames.find(event => event.type === "done");
  const row = await ledgerAfter(mode, value => value.sessionId === tab.id);
  check(mode + "开始时间与实际 HTTP 请求的 UTC 窗口一致", row && Date.parse(row.startedAt) >= began - 1000 && Date.parse(row.startedAt) <= Date.now() + 1000, row?.startedAt);
  cases.push({ mode, plan, ledger: safeRow(row), events: frames.map(frame => ({ type: frame.type, status: frame.status, messageId: frame.messageId, errorMessage: frame.errorMessage })) }); await save();
  check(mode + "正式旧会话 SSE 返回正文", response.ok() && response.headers()["content-type"]?.includes("text/event-stream") && frames.some(frame => frame.type === "token" && frame.content?.includes("测试回复")));
  if (status === "completed") check(mode + "业务回复正常完成并持久化", done?.status === "completed" && !!done.messageId && !frames.some(frame => frame.type === "error"));
  if (expected === "known") assertKnown(mode, row, status); else assertUnknown(mode, row, status);
  if (row && row.status !== "running") check(mode + "供应商两个关联 ID 保持一致", row.providerId === plan.providerId && row.upstreamRequestId === plan.upstreamId);
  return { row, done, tab, frames };
}
async function stoppedCase(mode) {
  const tab = await newTab(), plan = await fixture("/control", { mode });
  // Playwright HTTP 客户端会缓冲 SSE，另起请求、从正式消息 GET 取得生成中的消息和版本。
  const pending = actor.post("/api/tabs/" + tab.id + "/chat", { data: { content: "用户对话正文保护样本：" + mode, expectedVersion: tab.version, requestId: randomUUID() } }).then(async response => ({ response, frames: events(await response.text()) }));
  try {
    const stats = await poll(() => fixture("/stats"), value => value.calls.some(call => call.providerId === plan.providerId && call.phase === (mode === "stop-known" ? "usage-sent" : "text-sent")));
    must(mode + "上游到达预定停止边界", stats.calls.some(call => call.providerId === plan.providerId && call.phase === (mode === "stop-known" ? "usage-sent" : "text-sent")));
    const messages = await poll(() => json(actor, "/api/tabs/" + tab.id + "/messages"), value => value.messages.some(message => message.role === "assistant" && message.status === "generating" && !!message.content));
    const message = messages.messages.find(value => value.role === "assistant" && value.status === "generating");
    const running = await list({ status: "running", q: actor.userId }); await snapshot(mode + ":running", running);
    check(mode + "生成中查询返回待确认请求", running.requests.some(row => row.sessionId === tab.id && row.status === "running" && row.usageStatus === "pending" && row.costCny === null));
    const stopped = await actor.patch("/api/tabs/" + tab.id + "/messages", { data: { messageId: message?.id, expectedVersion: messages.tabVersion, requestId: randomUUID() } });
    check(mode + "正式主动停止 HTTP 成功", stopped.ok());
    const { frames } = await pending;
    check(mode + "业务消息以停止状态结束", frames.some(frame => ["done", "error"].includes(frame.type) && frame.status === "stopped") || (await json(actor, "/api/tabs/" + tab.id + "/messages")).messages.some(value => value.id === message?.id && value.status === "interrupted"));
    const row = await ledgerAfter(mode, value => value.sessionId === tab.id);
    if (mode === "stop-known") assertKnown(mode, row, "stopped"); else assertUnknown(mode, row, "stopped");
    check(mode + "主动停止不误标网站故障承担", row?.websiteBorne === false);
    const closed = await poll(() => fixture("/stats"), value => value.calls.some(call => call.providerId === plan.providerId && call.closed));
    check(mode + "取消传播至供应商连接", closed.calls.some(call => call.providerId === plan.providerId && call.closed && call.phase !== "stop-timeout"));
    cases.push({ mode, plan, ledger: safeRow(row) }); await save();
  } finally { await pending.catch(() => undefined); }
}

try {
  if (!/^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE ?? "") || !process.env.V144_ADMIN_EMAIL || !/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(process.env.V144_PROVIDER_FIXTURE_URL ?? "") || process.env.AI_MODE !== "replay") throw Error("拒绝脱离独立空库与本机替身运行");
  admin = await client(); actor = await client();
  const anonymous = await client(), normal = await client();
  const adminUser = await register(admin, process.env.V144_ADMIN_EMAIL), actorEmail = "cost-" + randomUUID() + "@test.local";
  const actorUser = await register(actor, actorEmail); actor.userId = actorUser.id;
  must("指定管理员登录身份正确", (await login(admin, process.env.V144_ADMIN_EMAIL))?.id === adminUser.id);
  must("模型调用账号登录成功", (await login(actor, actorEmail))?.id === actorUser.id);
  await json(admin,"/api/admin/users/"+actorUser.id+"/credits",{requestId:randomUUID(),type:"grant",amount:"100000",reason:"隔离成本专项调用资金"});
  const normalEmail = "viewer-" + randomUUID() + "@test.local"; await register(normal, normalEmail); await login(normal, normalEmail);
  project = await json(actor, "/api/projects", { name: "成本隔离验收" });

  await section("permissions-and-three-model-entrypoints", async () => {
    const before = await fixture("/stats");
    for (const [name, http, status] of [["匿名", anonymous, 401], ["普通用户", normal, 403]]) {
      const response = await http.get(api);
      check(name + "不能读取成本 API", response.status() === status);
      check(name + "拒绝响应不含账本或正文", !/(?:confirmedCostCny|providerId|usageStatus)/.test(await response.text()));
      check(name + "不能用伪造角色获得权限", (await http.get(api, { headers: { "X-Admin": "true", "X-User-Id": adminUser.id } })).status() === status);
    }
    const initial = await list(); await snapshot("empty-database", initial);
    check("空库成本为零且没有待确认请求", initial.total === 0 && initial.summary.requests === 0 && units(initial.summary.confirmedCostCny) === 0n && initial.summary.pending === 0);
    check("权限与查询请求不触发模型", (await fixture("/stats")).count === before.count);
    check("独立金额算例：高峰含缓存成本为 0.002016", calculatedCost(priceOracle(true)) === units("0.002016"));
    check("独立金额算例：空闲含缓存成本为 0.001008", calculatedCost(priceOracle(false)) === units("0.001008"));
    const old = await chatCase("normal"); initialDone = old.done;
    check("缺省 onReceipt 的真实旧 chat 入口仍完成可靠计量", old.row?.status === "completed" && old.row?.usageStatus === "reliable");
    check("旧会话关联用途、项目和会话", old.row?.purpose === "chat" && old.row?.projectId === project.id && old.row?.sessionId === old.tab.id);
    const stored = await json(actor, "/api/tabs/" + old.tab.id + "/messages");
    must("旧会话完成回复确实持久化", !!old.done?.messageId && stored.messages.some(message => message.id === old.done.messageId && message.status === "completed" && message.content.includes("测试回复")));

    const file = await json(actor, "/api/projects/" + project.id + "/files", { filename: "需求分析.md", content: "项目文件正文保护样本，不得展示在运营列表。", agent_type: "requirement_analyst", source_message_id: initialDone.messageId });
    polishPath = "/api/projects/" + project.id + "/files/" + file.id + "/polish";
    const iteration = await json(actor, "/api/projects/" + project.id + "/iterations", { displayName: "成本阶段验收" });
    const session = await json(actor, "/api/iterations/" + iteration.id + "/stages/analysis/sessions", {});
    const path = "/api/iterations/" + iteration.id + "/stages/analysis/sessions/" + session.session.id + "/messages";
    const stagePlan = await fixture("/control", { mode: "normal" });
    const stageResponse = await actor.post(path, { data: { requestId:randomUUID(), content: "用户对话正文保护样本：新版阶段" } });
    const stage = await stageResponse.json(), stageStored = await json(actor, path);
    check("新阶段会话正常返回且回复持久化", stageResponse.ok() && stage.assistantMessage?.status === "completed" && stageStored.messages.some(message => message.id === stage.assistantMessage?.id && message.content === stage.assistantMessage.content && message.status === "completed"));
    const stageRow = await ledgerAfter("new-stage", row => row.sessionId === session.session.id);
    assertKnown("新阶段", stageRow);
    check("缺省 onReceipt 的真实 stage 入口仍完成可靠计量", stageRow?.status === "completed" && stageRow?.usageStatus === "reliable");
    check("新阶段用途和供应商关联正确", stageRow?.purpose === "stage_chat" && stageRow?.providerId === stagePlan.providerId);

    // 创建 API 会规范化需求文档，GET 还会去掉 changelog；以同一公开 GET 的前后结果比较。
    const filePath = "/api/projects/" + project.id + "/files/" + file.id;
    const beforePolish = await json(actor, filePath);
    must("润色前从公开 files API 读到目标文件正文与版本", beforePolish.id === file.id && beforePolish.project_id === project.id && beforePolish.filename === file.filename && typeof beforePolish.content === "string" && beforePolish.content.includes("项目文件正文保护样本") && Number.isSafeInteger(beforePolish.version));
    const polishPlan = await fixture("/control", { mode: "normal" });
    const polished = await actor.post(polishPath, { data: { requestId: randomUUID(), content: "用户对话正文保护样本：文件润色" } });
    check("润色非流式入口正常返回正文", polished.ok() && (await polished.json()).polished?.includes("测试润色"));
    const polishRow = await ledgerAfter("polish", row => row.fileId === file.id);
    assertKnown("润色", polishRow);
    check("缺省 onReceipt 的真实 completion 入口仍完成可靠计量", polishRow?.status === "completed" && polishRow?.usageStatus === "reliable");
    check("润色用途、文件与项目关联正确", polishRow?.purpose === "polish" && polishRow?.projectId === project.id && polishRow?.fileId === file.id && polishRow?.providerId === polishPlan.providerId);
    const afterPolish = await json(actor, filePath);
    const fileEvidence = value => ({ id: value.id, projectId: value.project_id, filename: value.filename, version: value.version, contentBytes: typeof value.content === "string" ? Buffer.byteLength(value.content, "utf8") : null, contentSha256: typeof value.content === "string" ? createHash("sha256").update(value.content, "utf8").digest("hex") : null });
    const previewEvidence = { name: "polish-preview-file-unchanged", path: filePath, before: fileEvidence(beforePolish), after: fileEvidence(afterPolish), ledgerId: polishRow?.id, costCny: polishRow?.costCny, usageStatus: polishRow?.usageStatus };
    observations.push(previewEvidence); await save();
    check("润色预览未应用也保留供应商成本且不覆盖文件", afterPolish.id === beforePolish.id && afterPolish.project_id === beforePolish.project_id && afterPolish.filename === beforePolish.filename && afterPolish.version === beforePolish.version && afterPolish.content === beforePolish.content && polishRow?.usageStatus === "reliable" && typeof polishRow?.costCny === "string" && units(polishRow.costCny) > 0n, previewEvidence);
    const calls = (await fixture("/stats")).calls;
    check("三入口恰好三次真实应用到替身调用", calls.length === 3 && calls.filter(call => call.stream).length === 2 && calls.filter(call => !call.stream).length === 1);
    const rows = (await allRows()).requests;
    check("三入口记录发给上游的输出上限与传输类型", rows.length === 3 && rows.every(row => { const call = calls.find(value => value.providerId === row.providerId); return call && row.requestedModel === call.requestedModel && row.maxOutputTokens === call.maxTokens && row.transport === (call.stream ? "stream" : "completion"); }));
  });

  await section("missing-invalid-and-delayed-usage", async () => {
    for (const mode of ["missing", "negative", "fractional", "string", "unsafe", "total-mismatch", "cache-mismatch", "reasoning-invalid", "conflicting"]) await chatCase(mode, "unknown");
    const delayed = await chatCase("delayed");
    check("finish 后延迟 usage-only 尾块被完整读取", delayed.row?.usageStatus === "reliable" && delayed.row?.usage?.total_tokens === 1100);
    check("每个流式入口都向上游请求 include_usage", (await fixture("/stats")).calls.filter(call => call.stream).every(call => call.includeUsage));
  });

  await section("faults-stops-and-disconnections", async () => {
    for (const [mode, known, status] of [["failed-known", true, "failed"], ["failed-unknown", false, "failed"], ["interrupted", false, "interrupted"], ["disconnect", false, "failed"]]) {
      const { row } = await chatCase(mode, known ? "known" : "unknown", status);
      check(mode + "保留故障标识及网站承担事实", row?.websiteBorne === true && typeof row.errorCode === "string" && !!row.errorCode);
      if (known) check("故障免单没有抹除已知供应商成本", typeof row?.costCny === "string" && units(row.costCny) > 0n);
    }
    const resource = await chatCase("insufficient-system-resource", "known", "failed");
    const storedFailure = await json(actor, "/api/tabs/" + resource.tab.id + "/messages");
    check("HTTP200 流式资源不足按业务失败而非完成", resource.frames.some(frame => frame.type === "error" && frame.status === "failed") && !resource.frames.some(frame => frame.type === "done" && frame.status === "completed") && storedFailure.messages.some(message => message.role === "assistant" && message.status === "failed"));
    check("流式资源不足保留 finish、可靠成本并由网站承担", resource.row?.finishReason === "insufficient_system_resource" && resource.row?.websiteBorne === true && resource.row?.errorCode === "upstream_finish_error" && resource.row?.costCny !== null);
    const completionPlan = await fixture("/control", { mode: "insufficient-system-resource" });
    const completionResponse = await actor.post(polishPath, { data: { requestId: randomUUID(), content: "用户对话正文保护样本：资源不足润色" } });
    const completionBody = await completionResponse.json();
    check("HTTP200 completion 资源不足按业务失败且不返回成功预览", completionResponse.status() === 500 && typeof completionBody.error === "string" && !Object.hasOwn(completionBody, "polished"));
    const completionRow = await ledgerAfter("completion-resource", row => row.providerId === completionPlan.providerId);
    assertKnown("completion 资源不足", completionRow, "failed");
    check("completion 资源不足保留 finish、可靠成本并由网站承担", completionRow?.finishReason === "insufficient_system_resource" && completionRow?.websiteBorne === true && completionRow?.errorCode === "upstream_finish_error" && completionRow?.transport === "completion");
    cases.push({ mode: "completion-resource", plan: completionPlan, httpStatus: completionResponse.status(), ledger: safeRow(completionRow) }); await save();

    // 复用已有正式 HTTP 故障注入：上游已完成后网站快照事务失败。
    const iteration = await json(actor, "/api/projects/" + project.id + "/iterations", { displayName: "成本持久化故障验收" });
    const session = await json(actor, "/api/iterations/" + iteration.id + "/stages/prototype/sessions", {});
    const path = "/api/iterations/" + iteration.id + "/stages/prototype/sessions/" + session.session.id + "/messages";
    const sitePlan = await fixture("/control", { mode: "prototype" });
    const siteResponse = await actor.post(path, { headers: { "x-pm-verify-snapshot-failure": "1" }, data: { requestId:randomUUID(), content: "用户对话正文保护样本：快照失败" } });
    const siteBody = await siteResponse.json(), siteStored = await json(actor, path);
    check("供应商成功后网站快照失败返回业务失败并清理生成状态", siteResponse.status() === 502 && typeof siteBody.error === "string" && siteStored.messages.some(message => message.role === "assistant" && message.status === "failed") && siteStored.messages.every(message => message.status !== "generating"));
    const siteRow = await ledgerAfter("site-processing-failure", row => row.providerId === sitePlan.providerId);
    assertKnown("网站持久化失败", siteRow, "failed");
    check("网站持久化失败不抹除已知供应商成本", siteRow?.websiteBorne === true && siteRow?.errorCode === "site_processing_error" && siteRow?.finishReason === "stop");
    const retryPlan = await fixture("/control", { mode: "prototype" });
    const retry = await actor.post(path, { data: { requestId:randomUUID(), content: "用户对话正文保护样本：故障后重试" } });
    check("网站失败后同会话可再次生成证明业务锁已释放", retry.ok() && (await retry.json()).assistantMessage?.status === "completed");
    assertKnown("网站失败后重试", await ledgerAfter("site-processing-retry", row => row.providerId === retryPlan.providerId));
    await stoppedCase("stop-known"); await stoppedCase("stop-unknown");
  });

  let complete;
  await section("queries-pagination-cumulative-summary-and-private-response", async () => {
    // 用正式业务入口攒够两页；不直接往计量表插假记录。
    let count = (await list()).total;
    for (; count < 23; count++) await chatCase("normal");
    complete = await allRows(); await snapshot("all-records", complete);
    const rows = complete.requests, sample = rows.find(row => row.usageStatus === "reliable");
    must("成本查询存在可靠样本与两页数据", !!sample && rows.length > 20 && complete.pageSize === 20);
    for (const [name, q, matching] of [["完整请求 ID", sample.id, row => row.id === sample.id], ["完整用户 ID", actor.userId, row => row.userId === actor.userId], ["完整 provider ID", sample.providerId, row => row.providerId === sample.providerId], ["完整上游请求 ID", sample.upstreamRequestId, row => row.upstreamRequestId === sample.upstreamRequestId]]) {
      const filtered = await allRows({ q });
      check(name + "精确查询", filtered.total === rows.filter(matching).length && filtered.requests.every(matching));
      check(name + "查询不改变全累计 summary", JSON.stringify(filtered.summary) === JSON.stringify(complete.summary));
    }
    for (const q of [sample.id.slice(0, 8), sample.providerId.slice(0, 12), sample.providerId.toUpperCase(), sample.id.toUpperCase(), actorEmail, "不存在-" + randomUUID(), "' OR 1=1 --"]) {
      const result = await list({ q });
      check("不匹配或非完整 ID 不命中：" + q.slice(0, 20), result.total === 0 && result.requests.length === 0 && JSON.stringify(result.summary) === JSON.stringify(complete.summary));
    }
    for (const status of ["all", "running", "processing", "completed", "stopped", "failed", "interrupted"]) for (const usage of ["all", "reliable", "pending"]) {
      const expected = rows.filter(row => (status === "all" || row.status === status) && (usage === "all" || row.usageStatus === usage));
      const result = await allRows({ status, usage });
      check("状态/用量联合筛选 " + status + "/" + usage, result.total === expected.length && result.requests.length === expected.length && result.requests.every(row => expected.some(value => value.id === row.id)));
      check("联合筛选保留全累计 summary " + status + "/" + usage, JSON.stringify(result.summary) === JSON.stringify(complete.summary));
    }
    const first = await list({ page: "1" }), second = await list({ page: "2" }), last = await list({ page: "1000000" });
    check("两页记录完整、无重复且按稳定顺序返回", first.page === 1 && second.page === 2 && first.requests.length === 20 && second.requests.length === rows.length - 20 && new Set([...first.requests, ...second.requests].map(row => row.id)).size === rows.length && rows.every((row, index) => !index || Date.parse(rows[index - 1].startedAt) >= Date.parse(row.startedAt)));
    check("越界页夹至末页且全累计汇总保持", last.page === 2 && last.requests.map(row => row.id).join() === second.requests.map(row => row.id).join() && JSON.stringify(last.summary) === JSON.stringify(complete.summary));
    for (const query of [{ status: "bad" }, { usage: "awaitingUsage" }, { page: "0" }, { page: "-1" }, { page: "1.5" }, { page: "NaN" }, { page: "1000001" }, { q: "x".repeat(161) }]) check("非法查询返回 400 " + JSON.stringify(query).slice(0, 65), (await admin.get(api + "?" + new URLSearchParams(query))).status() === 400);
    const confirmed = rows.reduce((sum, row) => sum + (row.costCny === null ? 0n : units(row.costCny)), 0n);
    const website = rows.filter(row => row.websiteBorne);
    check("累计请求数、已知金额和待确认数量可逐笔核对", complete.summary.requests === rows.length && units(complete.summary.confirmedCostCny) === confirmed && complete.summary.pending === rows.filter(row => row.costCny === null).length);
    check("网站承担已知金额与未知数量分开累计", units(complete.summary.websiteCostCny) === website.reduce((sum, row) => sum + (row.costCny === null ? 0n : units(row.costCny)), 0n) && complete.summary.websitePending === website.filter(row => row.costCny === null).length);
    check("预算为累计 200 元且披露历史覆盖限制", complete.summary.budgetCny === "200" && complete.summary.budgetPeriod.includes("不按月重置") && !!complete.summary.historicalCoverage);
    const response = await admin.get(api), serialized = await response.text();
    check("成本 API 使用 private, no-store", /(?:^|,)\s*no-store(?:,|$)/i.test(response.headers()["cache-control"] ?? "") && /private/i.test(response.headers()["cache-control"] ?? ""));
    check("成本 API 不泄露对话文件异常正文或供应商凭据", privateSamples.every(text => !serialized.includes(text)) && privateSamples.every(text => !JSON.stringify(complete).includes(text)));
    check("ledger 默认结构无原始消息、正文、请求头和密钥字段", rows.every(row => Object.keys(row).every(key => !/^(?:content|messages|prompt|rawResponse|rawError|headers|apiKey|authorization)$/i.test(key))));
    for (const row of rows) check("请求 " + row.id + "元数据类型、UTC 时间和替身身份", typeof row.maxOutputTokens === "number" && Number.isSafeInteger(row.maxOutputTokens) && row.maxOutputTokens > 0 && ["stream", "completion"].includes(row.transport) && /Z$/.test(row.startedAt) && /Z$/.test(row.endedAt ?? "") && row.price?.fixture === true && row.price?.official === false);
  });

  await section("admin-page-desktop-mobile", async () => {
    complete ??= await allRows();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: await admin.storageState(), viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(20_000); context.setDefaultNavigationTimeout(120_000);
    const page = await context.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
    const forbiddenContext = await browser.newContext({ storageState: await normal.storageState() }), forbidden = await forbiddenContext.newPage(); forbidden.setDefaultNavigationTimeout(120_000);
    await forbidden.goto(base + pagePath);
    check("普通用户直访成本页面无权且不泄露列表", await forbidden.getByRole("heading", { name: "无权访问管理后台" }).isVisible() && !((await forbidden.locator("body").innerText()).includes(actor.userId)));
    const anonymousContext = await browser.newContext(), anonymousPage = await anonymousContext.newPage(); anonymousPage.setDefaultNavigationTimeout(120_000);
    await anonymousPage.goto(base + pagePath);
    check("匿名直访成本页面跳转登录", new URL(anonymousPage.url()).pathname === "/login" && new URL(anonymousPage.url()).searchParams.get("callbackUrl") === pagePath);
    await page.goto(base + "/admin"); await page.getByRole("link", { name: "模型请求与成本", exact: true }).click();
    await page.getByRole("heading", { name: "模型请求与成本", exact: true }).waitFor();
    check("管理员可从后台导航进入正式成本页面", new URL(page.url()).pathname === pagePath && await page.getByRole("main").count() === 1);
    check("桌面列表第一页显示 20 笔且累计成本准确", await page.locator("tbody tr").count() === 20 && (await page.getByLabel("累计模型成本").innerText()).includes(complete.summary.confirmedCostCny));
    const desktopText = await page.locator("body").innerText(), desktopHtml = await page.content();
    check("桌面正文与 HTML 不泄露对话、文件、异常正文或凭据", privateSamples.every(value => !desktopText.includes(value) && !desktopHtml.includes(value)));
    const desktopResponse = await page.reload();
    // Next dev 普通页面响应由框架覆盖；生产禁缓存需在 production 构建单独核验。
    const cacheControl = desktopResponse.headers()["cache-control"] ?? "";
    const cacheEvidence = { name: "model-cost-page-dev-cache-control", serverMode: "development", cacheControl };
    observations.push(cacheEvidence); await save();
    check("开发模式成本页面 HTTP 响应使用 no-cache 与 must-revalidate", /(?:^|,)\s*no-cache\s*(?:,|$)/i.test(cacheControl) && /(?:^|,)\s*must-revalidate\s*(?:,|$)/i.test(cacheControl), cacheEvidence);
    await page.screenshot({ path: join(output, "model-cost-desktop.png"), fullPage: true });
    await page.getByRole("link", { name: "下一页", exact: true }).click();
    await page.waitForURL(url => url.searchParams.get("page") === "2");
    await page.getByRole("navigation", { name: "模型请求分页" }).getByText("第 2 / 2 页", { exact: true }).waitFor();
    check("桌面分页第二页记录数量正确", await page.locator("tbody tr").count() === complete.total - 20);
    await page.screenshot({ path: join(output, "model-cost-desktop-page2.png"), fullPage: true });
    const sample = complete.requests.find(row => row.status === "failed" && row.costCny !== null);
    must("页面已知故障样本存在", !!sample);
    const cumulativeText = await page.getByLabel("累计模型成本").innerText();
    await page.getByLabel("调用、账号或供应商请求 ID").fill(sample.providerId);
    await page.getByLabel("请求状态", { exact: true }).selectOption("failed"); await page.getByLabel("用量状态", { exact: true }).selectOption("reliable");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.waitForURL(url => url.searchParams.get("q") === sample.providerId && url.searchParams.get("status") === "failed" && url.searchParams.get("usage") === "reliable");
    await page.getByRole("navigation", { name: "模型请求分页" }).getByText("第 1 / 1 页", { exact: true }).waitFor();
    check("页面组合筛选重置页码并显示已知故障成本", await page.locator("tbody tr").count() === 1 && (await page.locator("tbody").innerText()).includes(sample.id) && (await page.locator("tbody").innerText()).includes(sample.costCny) && (await page.locator("tbody").innerText()).includes("网站承担"));
    check("页面筛选不改变累计汇总", await page.getByLabel("累计模型成本").innerText() === cumulativeText);
    await page.locator("tbody details summary").click();
    check("页面可展开价格、用量与隔离依据", (await page.locator("tbody").innerText()).includes("隔离供应商替身证据") && (await page.locator("tbody").innerText()).includes("缓存命中 400") && (await page.locator("tbody").innerText()).includes("价格快照"));
    await page.screenshot({ path: join(output, "model-cost-desktop-filtered.png"), fullPage: true });
    await page.reload();
    check("刷新保留筛选与持久结果", await page.getByLabel("调用、账号或供应商请求 ID").inputValue() === sample.providerId && (await page.locator("tbody").innerText()).includes(sample.id));
    await page.getByRole("link", { name: "重置", exact: true }).click(); await page.waitForURL(url => !url.search);
    await page.getByRole("navigation", { name: "模型请求分页" }).getByText("第 1 / 2 页", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
    check("390px 手机页面无整体横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const region = page.getByRole("region", { name: "模型请求列表，可横向滚动" }); await region.focus();
    check("手机表格可键盘聚焦且独立横向滚动", await region.getAttribute("tabindex") === "0" && await region.evaluate(element => element === document.activeElement && element.scrollWidth > element.clientWidth && ["auto", "scroll"].includes(getComputedStyle(element).overflowX)));
    await page.screenshot({ path: join(output, "model-cost-mobile.png"), fullPage: true });
    await region.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await page.screenshot({ path: join(output, "model-cost-mobile-details.png"), fullPage: true });
    const pending = complete.requests.find(row => row.usageStatus === "pending");
    await page.getByLabel("调用、账号或供应商请求 ID").fill(pending.id); await page.getByLabel("用量状态", { exact: true }).selectOption("pending");
    await page.getByRole("button", { name: "查询", exact: true }).click(); await page.waitForURL(url => url.searchParams.get("q") === pending.id);
    await page.getByRole("navigation", { name: "模型请求分页" }).getByText("第 1 / 1 页", { exact: true }).waitFor();
    check("手机筛选缺失用量明确显示待确认而非零元", (await page.locator("tbody").innerText()).includes(pending.id) && (await page.locator("tbody").innerText()).includes("成本待确认") && !(await page.locator("tbody").innerText()).includes("¥0"));
    await page.screenshot({ path: join(output, "model-cost-mobile-pending.png"), fullPage: true });
    const text = await page.locator("body").innerText(), html = await page.content();
    check("桌面/手机页面和 HTML 不含正文或凭据", privateSamples.every(value => !text.includes(value) && !html.includes(value)));
    check("页面无未捕获浏览器异常", errors.length === 0, errors);
    const calls = await fixture("/stats");
    check("后台查询和浏览页面不产生额外模型调用", calls.count === complete.summary.requests && calls.planned === null);
  });
} catch (error) { if (!error.counted) check("场景准备失败：" + String(error.message).split("\n")[0], false); }
finally {
  await browser?.close(); for (const http of clients) await http.dispose();
  await save();
  await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, aiMode: process.env.AI_MODE, applicationAiMode: "live", fixture: true, live: false, realLlmCostCny: "0", workflows, assertions, observations, limitations: ["页面仅校验 Next development 的 no-cache, must-revalidate；生产页面禁缓存由独立 production 构建验证。", "金额双时段算例均独立核对；正式 HTTP 仅证明本次实际落库价格时段，未修改生产时钟。", "不发起官方 live 样本；共享 runner 中 aiMode=replay 是 scenario 子进程保护值，applicationAiMode=live 的正式服务只连接 127.0.0.1 替身。", "网站快照失败与重试通过正式 HTTP 注入；计量补标 SQL 自身抛错没有正式 HTTP 注入边界，本专项未模拟该异常。"] }, null, 2));
  console.log("结果: " + pass + " 通过, " + fail + " 失败");
}
process.exit(fail > 0 ? 1 : 0);
