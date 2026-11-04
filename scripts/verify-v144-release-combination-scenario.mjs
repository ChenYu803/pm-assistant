// #13：跨票业务链只经应用 HTTP 与浏览器验证；邮件和模型只在外部边界替身控制。
import { request, chromium } from "playwright-core";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { requestRegistrationCode, latestEmailCode, fixtureRequest } from "./verify-email-fixture.mjs";
let base = process.env.BASE_URL, pass = 0, fail = 0, browser;
const clients = [], assertions = [], workflows = [], screenshots = [], responses = [], output = process.env.V141_REPLAY_OUTPUT_DIR;
const financialSnapshots = [], recoveryRuns = [], cleanup = { clockReset: false };
// 运行中的请求没有 pending 补查入口；保留真实覆盖边界，不能把 deadline 免单写成 pending 转扣费。
const coverageLimitations = ["现有公开流程不能对已完成且缺 usage 的 pending 调用补查供应商；本组合未覆盖 pending 在24小时内补齐可靠证据并转扣费。held-usage 验证的是仍运行请求的可靠完成，以及 deadline 免单后原响应迟到 usage 只补网站成本。"];
const password = "release-isolated-12345", nextPassword = "release-reset-67890";
function check(name, okay) { assertions.push({ name, okay: Boolean(okay) }); console.log((okay ? "✅ " : "❌ ") + name); if (okay) pass++; else { fail++; throw Error(name); } }
async function api(actor, route, data, status = 200, method = data === undefined ? "GET" : "POST") {
  const response = await actor.http.fetch(base + route, { method, ...(data === undefined ? {} : { data }) });
  const raw = await response.text();
  let body; try { body = JSON.parse(raw); } catch { body = { snippet: raw.slice(0, 240) }; }
  responses.push({ method, route, status: response.status(), body });
  check(method + " " + route.split("?")[0] + " HTTP " + status, response.status() === status);
  return body;
}
async function login(actor, pw = password) {
  const { csrfToken } = await api(actor, "/api/auth/csrf");
  await actor.http.post(base + "/api/auth/callback/credentials", { form: { email: actor.email, password: pw, csrfToken, callbackUrl: base + "/profile" }, headers: { "X-Auth-Return-Redirect": "1" } });
  actor.user = (await api(actor, "/api/auth/session")).user;
  check("正式登录账号身份一致", actor.user?.email === actor.email && !!actor.user.id);
}
async function account(email = "release-" + randomUUID() + "@test.local", giftInvite) {
  const actor = { email, http: await request.newContext({ timeout: 90000 }) }; clients.push(actor.http);
  const code = await requestRegistrationCode(actor.http, email);
  actor.registration = await api(actor, "/api/auth/register", { email, password, code, ...(giftInvite ? { giftInvite } : {}) }, 201);
  await login(actor); return actor;
}
async function provider(route, data) {
  const r = await fetch(new URL(route, process.env.V144_PROVIDER_FIXTURE_URL), { ...(data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}) });
  if (!r.ok) throw Error("本机供应商控制失败"); return r.json();
}
async function waitFor(read, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(80);
  }
  throw Error("等待隔离供应商状态超时");
}
async function advanceClock(seconds) {
  while (seconds > 0) {
    const step = Math.min(seconds, 3600);
    await fixtureRequest("/advance", { seconds: step });
    seconds -= step;
  }
}
async function runRecovery(label) {
  const result = await new Promise((resolveProcess, reject) => {
    const child = spawn(process.execPath, ["--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href, "scripts/pending-usage-recovery.ts"], {
      env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let outputText = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { outputText += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(Error("待核对恢复进程超过60秒")); }, 60000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => {
      clearTimeout(timer);
      if (code !== 0) return reject(Error("待核对恢复失败：" + outputText.slice(-1200)));
      try { resolveProcess(JSON.parse(outputText.trim())); }
      catch { reject(Error("恢复CLI未返回有效JSON摘要")); }
    });
  });
  recoveryRuns.push({ label, ...result });
  check(label + "恢复CLI成功且无失败项", Number.isInteger(result.scanned) && result.scanned >= 0 && result.failed === 0);
  return result;
}
function units(value) {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d{1,8})?$/.test(value)) throw Error("公开账单金额格式无效");
  const negative = value.startsWith("-"), [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return BigInt(whole + fraction.padEnd(8, "0")) * (negative ? -1n : 1n);
}
async function statement(actor) {
  const value = await api(actor, "/api/credits");
  for (let page = 2; page <= Math.ceil(value.total / value.pageSize); page++) value.entries.push(...(await api(actor, "/api/credits?page=" + page)).entries);
  check("公开账单分页无遗漏或重复", value.entries.length === value.total && new Set(value.entries.map(row => row.id)).size === value.total);
  return value;
}
function checkFunds(label, value) {
  const balances = [value.balance.gift.available, value.balance.gift.reserved, value.balance.purchased.available, value.balance.purchased.reserved, value.refundHeld].map(units);
  const frozen = units(value.balance.gift.reserved) + units(value.balance.purchased.reserved);
  check(label + "来源余额与退款锁均非负", balances.every(amount => amount >= 0n));
  check(label + "账号冻结总额等于全部未结调用预留", frozen === value.pendingCalls.reduce((sum, row) => sum + units(row.reserved), 0n));
  check(label + "完整流水净额等于可用、冻结与退款锁总额", value.entries.reduce((sum, row) => sum + units(row.amount), 0n) === balances.reduce((sum, amount) => sum + amount, 0n));
  financialSnapshots.push({ label, balance: value.balance, refundHeld: value.refundHeld, pendingCalls: value.pendingCalls, entryIds: value.entries.map(row => row.id) });
}
function fundsSignature(value) {
  return JSON.stringify({ balance: value.balance, refundHeld: value.refundHeld, pendingCalls: value.pendingCalls, entries: value.entries.map(row => row.id).sort() });
}
function callEntries(value, id, type) { return value.entries.filter(row => row.context?.callId === id && row.businessType === "model_" + type); }
function checkCall(label, value, id, settled) {
  check(label + "预留、结算、释放流水唯一", callEntries(value, id, "reserve").length === 1 && callEntries(value, id, "settle").length === (settled ? 1 : 0) && callEntries(value, id, "release").length === 1);
}
async function heldRequest(actor, sessions, label) {
  const { session } = await api(actor, sessions, {}, 201);
  const path = sessions + "/" + session.id + "/messages", data = { content: label, requestId: randomUUID() };
  const plan = await provider("/control", { mode: "held-usage" });
  // 立即接住拒绝，失败清理时不留下未处理的网络 Promise。
  const response = actor.http.post(base + path, { data }).then(value => ({ value }), error => ({ error }));
  await waitFor(() => provider("/stats"), value => value.calls.some(row => row.providerId === plan.providerId && row.phase === "waiting-usage-release"));
  const history = await api(actor, path);
  const call = history.messages.find(row => row.role === "assistant")?.creditCall;
  check(label + "由正式消息API产生持久预留", call?.state === "reserved" && units(call.reserved) > 0n);
  return { path, data, response, plan, call };
}
async function finishHeld(target, expectedStatus) {
  await provider("/release-usage", { providerId: target.plan.providerId });
  const { value: response, error } = await target.response;
  if (error) throw error;
  const body = await response.json();
  responses.push({ method: "POST", route: target.path, status: response.status(), body });
  check("释放原供应商usage后的应用HTTP " + expectedStatus, response.status() === expectedStatus);
  return body;
}
async function restart() {
  const result = await new Promise((done, reject) => {
    const timer = setTimeout(() => { process.off("message", listener); reject(Error("重启隔离应用超时")); }, 60000);
    function listener(message) { if (message.type !== "restart-credit-app") return; clearTimeout(timer); process.off("message", listener); if (message.error) reject(Error(message.error)); else done(message); }
    process.on("message", listener); process.send({ type: "restart-credit-app" });
  });
  base = result.base;
}
try {
  check("只允许隔离库和本机供应商", /^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE ?? "") && /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(process.env.V144_PROVIDER_FIXTURE_URL ?? ""));
  const admin = await account(process.env.V144_ADMIN_EMAIL);
  const { codes } = await api(admin, "/api/admin/gift-invites", { reason: "发布组合隔离验收" }, 201);
  check("首批邀请码有效且唯一", codes.length === 100 && new Set(codes).size === 100);
  const actor = await account(undefined, codes[0]);
  check("注册兑换已到账", actor.registration.giftInvite.redeemed === true);
  const profileActor = await account();
  await api(profileActor, "/api/gift-invites", { code: codes[1], requestId: randomUUID() });
  const initial = await api(actor, "/api/credits");
  check("注册入口初始账单2000赠送/0购买/0冻结", initial.balance.gift.available === "2000" && initial.balance.purchased.available === "0" && initial.balance.gift.reserved === "0");
  const input = { accountId: actor.user.id, requestId: randomUUID(), paidRmb: "0.01", receiptReference: "release-" + randomUUID(), reason: "隔离人工充值，非真实资金" };
  const deposits = await Promise.all([api(admin, "/api/admin/recharges", input), api(admin, "/api/admin/recharges", input)]);
  check("并发充值相同操作仅同一到账事实", deposits[0].entry.id === deposits[1].entry.id);
  const entry = deposits[0].entry;
  check("充值后赠送2000/购买10", (await api(actor, "/api/credits")).balance.purchased.available === "10");
  workflows.push("both-invites-and-concurrent-recharge");

  const project = await api(actor, "/api/projects", { name: "发布跨票组合" }, 201);
  const iteration = await api(actor, "/api/projects/" + project.id + "/iterations", { displayName: "发布验证" }, 201);
  const sessions = "/api/iterations/" + iteration.id + "/stages/analysis/sessions";
  const { session } = await api(actor, sessions, {}, 201);
  const messagePath = sessions + "/" + session.id + "/messages";
  await provider("/control", { mode: "normal" });
  const requestId = randomUUID(), content = "😀 发布组合首条提示词保留空格";
  const result = await api(actor, messagePath, { content, requestId });
  const call = result.messages.find(row => row.id === result.assistantMessage.id)?.creditCall;
  check("正常生成可靠结算且使用赠送积分", call?.state === "settled" && ["2.016", "4.032"].includes(call.consumed));
  const consumed = call.consumed;
  const beforeRetry = (await provider("/stats")).count;
  await api(actor, messagePath, { content, requestId });
  check("网络重发不新增上游或隐藏命名调用", (await provider("/stats")).count === beforeRetry && beforeRetry === 1);
  const detail = await api(actor, "/api/iterations/" + iteration.id + "/sessions/" + session.id);
  check("默认名称按Unicode首十字符持久化", detail.title === Array.from(content).slice(0, 10).join(""));
  const after = await api(actor, "/api/credits");
  check("消费账单赠送优先且购买10保持完整", after.balance.gift.available === (consumed === "4.032" ? "1995.968" : "1997.984") && after.balance.purchased.available === "10" && after.balance.gift.reserved === "0" && after.balance.purchased.reserved === "0");
  await restart();
  check("重启后余额与流水完整保留", JSON.stringify((await api(actor, "/api/credits")).balance) === JSON.stringify(after.balance));
  await api(actor, "/api/auth/email-code", { email: actor.email, purpose: "reset-password" });
  const code = await latestEmailCode(actor.email, "reset-password");
  await api(actor, "/api/auth/reset-password", { email: actor.email, password: nextPassword, code });
  const restored = { email: actor.email, http: await request.newContext({ timeout: 90000 }) }; clients.push(restored.http);
  await login(restored, nextPassword);
  check("找回后同一账号及资金记录", restored.user.id === actor.user.id && JSON.stringify((await api(restored, "/api/credits")).balance) === JSON.stringify(after.balance));

  await provider("/control", { mode: "context-document" });
  const generated = await api(actor, messagePath, { content: "发布回归润色文件来源", requestId: randomUUID() });
  const candidate = generated.messages.find(row => row.id === generated.assistantMessage.id)?.candidate;
  const generatedCall = generated.messages.find(row => row.id === generated.assistantMessage.id)?.creditCall;
  check("润色前通过正式会话生成候选并可靠结算", !!candidate?.id && generatedCall?.state === "settled" && ["2.016", "4.032"].includes(generatedCall.consumed));
  await api(actor, "/api/iterations/" + iteration.id + "/sessions/" + session.id + "/candidates/" + candidate.id, { action: "write", filename: "需求分析-发布回归.md", expectedOperation: "create" });
  const file = (await api(actor, "/api/projects/" + project.id + "/files")).find(row => row.filename === "需求分析-发布回归.md");
  check("正式写入后文件可用于润色", !!file?.id);
  const polishPath = "/api/projects/" + project.id + "/files/" + file.id + "/polish";
  await provider("/control", { mode: "normal" });
  const polishInput = { content: "发布回归的正常润色输入", requestId: randomUUID() };
  const polished = await api(actor, polishPath, polishInput);
  check("正常润色走正式API且可靠结算", polished.creditCall?.state === "settled" && ["2.016", "4.032"].includes(polished.creditCall.consumed));
  const polishBalance = await statement(actor);
  checkCall("正常润色", polishBalance, polished.creditCall.id, true);
  checkFunds("润色后", polishBalance);
  const polishCount = (await provider("/stats")).count;
  await api(actor, polishPath, polishInput);
  check("润色原请求重试不重复扣费或调用供应商", (await provider("/stats")).count === polishCount && fundsSignature(await statement(actor)) === fundsSignature(polishBalance));

  const stoppedTarget = await api(actor, sessions, {}, 201), stopRequestId = randomUUID();
  const stopMessagePath = sessions + "/" + stoppedTarget.session.id + "/messages";
  const stopPlan = await provider("/control", { mode: "stop-known" });
  const stoppingCall = actor.http.post(base + stopMessagePath, { data: { content: "发布回归主动停止", requestId: stopRequestId } });
  await waitFor(() => provider("/stats"), value => value.calls.some(row => row.providerId === stopPlan.providerId && row.phase === "usage-sent"));
  const stopPath = "/api/iterations/" + iteration.id + "/sessions/" + stoppedTarget.session.id + "/stop";
  const stopResponses = await Promise.all([actor.http.post(base + stopPath), actor.http.post(base + stopPath)]);
  check("可靠用量到达时重复停止请求均被安全处理", stopResponses.every(response => [200, 409].includes(response.status())));
  await stoppingCall;
  const stoppedHistory = await api(actor, stopMessagePath);
  const stoppedCall = stoppedHistory.messages.find(row => row.role === "assistant")?.creditCall;
  check("停止场景按可靠用量只结算一次", stoppedCall?.state === "settled" && stoppedCall.reason === "stopped_confirmed" && ["2.016", "4.032"].includes(stoppedCall.consumed));
  const settledEntries = (await api(actor, "/api/credits")).entries.filter(row => row.context?.callId === stoppedCall.id && row.businessType === "model_settle");
  check("停止重复请求未重复记账", settledEntries.length === 1);

  const beforeFailures = await statement(actor);
  checkCall("主动停止", beforeFailures, stoppedCall.id, true);
  const failedTarget = await api(actor, sessions, {}, 201);
  await provider("/control", { mode: "failed-unknown" });
  const failedResponse = await actor.http.post(base + sessions + "/" + failedTarget.session.id + "/messages", { data: { content: "未知供应商故障免单", requestId: randomUUID() } });
  const failedBody = await failedResponse.json(), failedCall = failedBody.messages?.find(row => row.role === "assistant")?.creditCall;
  responses.push({ method: "POST", route: sessions + "/" + failedTarget.session.id + "/messages", status: failedResponse.status(), body: failedBody });
  check("未知故障立即免单且不遗留冻结", failedResponse.status() === 502 && failedCall?.state === "released" && failedCall.consumed === "0");
  const afterUnknown = await statement(actor);
  check("未知故障前后来源余额不变", JSON.stringify(afterUnknown.balance) === JSON.stringify(beforeFailures.balance));
  checkCall("未知故障", afterUnknown, failedCall.id, false);
  const knownTarget = await api(actor, sessions, {}, 201);
  await provider("/control", { mode: "failed-known" });
  const knownBody = await api(actor, sessions + "/" + knownTarget.session.id + "/messages", { content: "已知成本的供应商故障免单", requestId: randomUUID() }, 502);
  const knownCall = knownBody.messages?.find(row => row.role === "assistant")?.creditCall;
  check("已知可靠成本的供应商故障仍立即免单", knownCall?.state === "released" && knownCall.consumed === "0");
  const afterKnown = await statement(actor);
  check("已知故障前后来源余额不变", JSON.stringify(afterKnown.balance) === JSON.stringify(beforeFailures.balance));
  checkCall("已知故障", afterKnown, knownCall.id, false);
  const knownModel = (await api(admin, "/api/admin/model-requests?q=" + knownCall.id)).requests.find(row => row.id === knownCall.id);
  check("故障已知成本保留后台且由网站承担", knownModel?.websiteBorne && knownModel.usageStatus === "reliable" && ["0.001008", "0.002016"].includes(knownModel.costCny));

  const beforePending = await statement(actor);
  checkFunds("正常、润色、停止与故障之后", beforePending);
  const pendingTarget = await api(actor, sessions, {}, 201);
  await provider("/control", { mode: "missing" });
  const pendingPath = sessions + "/" + pendingTarget.session.id + "/messages";
  const pendingBody = await api(actor, pendingPath, { content: "重启后恢复的待核对调用", requestId: randomUUID() });
  const pendingCall = pendingBody.messages?.find(row => row.role === "assistant")?.creditCall;
  check("缺失用量的正式请求完成并进入待核对", pendingCall?.state === "pending");
  const pendingBalance = await statement(actor);
  check("待核对只冻结赠送、不消费也不动购买积分", pendingBalance.pendingCalls.some(row => row.id === pendingCall.id && row.state === "pending") && units(pendingBalance.balance.gift.available) + units(pendingBalance.balance.gift.reserved) === units(beforePending.balance.gift.available) && pendingBalance.balance.purchased.available === "10");
  checkFunds("缺失用量待核对", pendingBalance);
  await restart();
  const restartedPending = await statement(actor);
  check("应用重启完整保留待核对、资金与已有流水", fundsSignature(restartedPending) === fundsSignature(pendingBalance));
  await runRecovery("重启后未到期");
  await runRecovery("重启后重复恢复");
  check("无可靠证据时重复恢复不凭估算扣费", fundsSignature(await statement(actor)) === fundsSignature(pendingBalance));

  // pending 与另一会话的运行中预留共存，释放原响应后经应用正常完成、可靠结算。
  const early = await heldRequest(actor, sessions, "持有usage后正常完成");
  const parallel = await statement(actor);
  check("不同会话待核对与运行中预留同时可见", parallel.pendingCalls.some(row => row.id === pendingCall.id && row.state === "pending") && parallel.pendingCalls.some(row => row.id === early.call.id && row.state === "reserved") && parallel.pendingCalls.length === 2);
  checkFunds("两会话同时冻结", parallel);
  await runRecovery("运行中请求未到deadline");
  check("恢复worker不误动有效运行中的预留", fundsSignature(await statement(actor)) === fundsSignature(parallel));
  const earlyBody = await finishHeld(early, 200);
  const earlyCall = earlyBody.messages?.find(row => row.role === "assistant")?.creditCall;
  check("持有后原响应可靠完成并仅扣实际消耗", earlyCall?.id === early.call.id && earlyCall.state === "settled" && ["2.016", "4.032"].includes(earlyCall.consumed));
  const earlyFinished = await statement(actor);
  checkCall("持有后正常结算", earlyFinished, early.call.id, true);
  checkFunds("一笔结算另一笔待核对", earlyFinished);
  const earlyCount = (await provider("/stats")).count;
  await api(actor, early.path, early.data);
  await runRecovery("可靠结算后再次恢复");
  check("可靠完成的请求重发与恢复不重复访问上游或记账", (await provider("/stats")).count === earlyCount && fundsSignature(await statement(actor)) === fundsSignature(earlyFinished));

  // 不伪装 pending：尚在运行的原响应超过deadline，worker先免单，迟到usage只能补网站成本。
  const late = await heldRequest(actor, sessions, "deadline免单后原响应迟到usage");
  const lateReserved = await statement(actor);
  checkFunds("迟到证据请求仍运行", lateReserved);
  await advanceClock(3600);
  await runRecovery("运行请求超过deadline");
  const deadlineReleased = await statement(actor);
  check("deadline恢复仅释放运行请求、另一笔pending继续冻结", !deadlineReleased.pendingCalls.some(row => row.id === late.call.id) && deadlineReleased.pendingCalls.length === 1 && deadlineReleased.pendingCalls[0].id === pendingCall.id);
  checkCall("deadline免单", deadlineReleased, late.call.id, false);
  checkFunds("deadline释放后", deadlineReleased);
  const beforeLateModel = (await api(admin, "/api/admin/model-requests?q=" + late.call.id)).requests.find(row => row.id === late.call.id);
  check("迟到usage前后台明确记为中断、网站承担且成本待确认", beforeLateModel?.status === "interrupted" && beforeLateModel.websiteBorne && beforeLateModel.usageStatus === "pending" && beforeLateModel.costCny === null);
  await runRecovery("deadline释放后重复恢复");
  check("重复恢复不重复释放冻结", fundsSignature(await statement(actor)) === fundsSignature(deadlineReleased));
  await finishHeld(late, 502);
  const lateHistory = await api(actor, late.path);
  const lateCall = lateHistory.messages?.find(row => row.role === "assistant")?.creditCall;
  check("迟到可靠证据不能将免单改写为扣费", lateCall?.id === late.call.id && lateCall.state === "released" && lateCall.consumed === "0");
  const afterLate = await statement(actor);
  check("迟到证据后资金与所有流水完全不变", fundsSignature(afterLate) === fundsSignature(deadlineReleased));
  const lateModel = (await api(admin, "/api/admin/model-requests?q=" + late.call.id)).requests.find(row => row.id === late.call.id);
  check("原供应商响应的迟到可靠usage只补网站真实成本", lateModel?.websiteBorne && lateModel.status === "interrupted" && lateModel.usageStatus === "reliable" && ["0.001008", "0.002016"].includes(lateModel.costCny) && lateModel.providerId === late.plan.providerId && lateModel.usage?.total_tokens === 1100 && lateModel.price?.fixture === true);
  await runRecovery("迟到证据后再次恢复");
  check("补齐成本后重复恢复仍不追扣", fundsSignature(await statement(actor)) === fundsSignature(afterLate));

  await advanceClock(22 * 3600);
  await runRecovery("pending23小时");
  const beforeExpiry = await statement(actor);
  check("pending23小时仍保持原冻结且无结算", beforeExpiry.pendingCalls.some(row => row.id === pendingCall.id && row.state === "pending") && fundsSignature(beforeExpiry) === fundsSignature(afterLate));
  await advanceClock(3601);
  await Promise.all([runRecovery("pending满24小时并发恢复A"), runRecovery("pending满24小时并发恢复B")]);
  const expiredBalance = await statement(actor);
  check("pending满24小时免单释放全部剩余冻结", expiredBalance.pendingCalls.length === 0 && expiredBalance.balance.gift.reserved === "0" && expiredBalance.balance.purchased.reserved === "0" && units(expiredBalance.balance.gift.available) === units(beforeExpiry.balance.gift.available) + units(pendingCall.reserved));
  checkCall("pending24小时免单", expiredBalance, pendingCall.id, false);
  checkFunds("24小时释放后", expiredBalance);
  await runRecovery("24小时释放后重复恢复");
  check("到期后重复恢复无重复记账", fundsSignature(await statement(actor)) === fundsSignature(expiredBalance));
  await fixtureRequest("/clock-reset", {});
  await restart();
  check("最终重启保留免单、可靠结算、来源余额与唯一流水", fundsSignature(await statement(actor)) === fundsSignature(expiredBalance));
  workflows.push("normal-polish-stop-failure-pending-restart-expiry");
  workflows.push("gift-first-generation-retry-naming-restart-password-reset");

  const beforeRefund = await statement(restored);
  const refundInput = { accountId: actor.user.id, rechargeEntryId: entry.id, requestId: randomUUID(), refundRmb: "0.01", reason: "隔离退还尚未消费的原充值" };
  const refund = (await api(admin, "/api/admin/refunds", refundInput)).refund;
  const held = await statement(restored);
  checkFunds("原购买积分退款锁定", held);
  check("原购买10全部退款锁定，赠送余额不变", held.balance.purchased.available === "0" && held.refundHeld === "10" && held.balance.gift.available === beforeRefund.balance.gift.available);
  await api(profileActor, "/api/admin/refunds", refundInput, 403);
  await api(profileActor, messagePath, undefined, 404);
  const transfer = { action: "confirm-transfer", externalReference: "isolated-out-" + randomUUID(), reason: "隔离模拟外部成功，无真实转账" };
  const completed = await api(admin, "/api/admin/refunds/" + refund.id, transfer, 200, "PATCH");
  check("退款最终已完成且保留原充值来源", completed.refund.accountingStatus === "completed" && completed.refund.rechargeEntryId === entry.id);
  await api(admin, "/api/admin/refunds", refundInput);
  await api(admin, "/api/admin/refunds/" + refund.id, transfer, 200, "PATCH");
  const final = await statement(restored);
  checkFunds("退款完成", final);
  check("退款完成后赠送余额不变、购买和退款锁均为0", final.balance.gift.available === beforeRefund.balance.gift.available && final.balance.purchased.available === "0" && final.refundHeld === "0" && final.balance.gift.reserved === "0");
  const allEntries = final.entries;
  const chargedCalls = [call, generatedCall, polished.creditCall, stoppedCall, earlyCall];
  for (const item of chargedCalls) {
    checkCall("最终可靠调用" + item.id, final, item.id, true);
    check("该笔实际消费与公开账单金额相符", callEntries(final, item.id, "settle")[0].amount === "-" + item.consumed);
  }
  check("最终赠送余额等于2000减去五笔已验收可靠消耗", units(final.balance.gift.available) === units("2000") - chargedCalls.reduce((sum, item) => sum + units(item.consumed), 0n) && allEntries.filter(row => row.businessType === "model_settle").length === chargedCalls.length);
  check("充值、首笔可靠消费及本次退款均仅记账一次", allEntries.filter(row => row.businessType === "manual_recharge").length === 1 && allEntries.filter(row => row.businessType === "model_settle" && row.context?.callId === call.id).length === 1 && allEntries.filter(row => row.businessType === "manual_refund" && row.context?.refundId === refund.id).length === 1);
  const modelRows = await api(admin, "/api/admin/model-requests?q=" + call.id);
  check("运营者能核对同一消费的可靠用量及隔离价格", modelRows.requests.some(row => row.id === call.id && row.usageStatus === "reliable" && row.price?.fixture === true));
  workflows.push("unused-original-purchase-refund-and-permissions");

  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, storageState: await restored.http.storageState() });
    const page = await context.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.message));
    for (const [label, route] of [["profile", "/profile"], ["workspace", "/projects/" + project.id + "/iterations/" + iteration.id]]) {
      await page.goto(base + route, { waitUntil: "networkidle", timeout: 90000 });
      const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      check(label + " " + width + "无整页横向溢出", layout.scroll <= layout.width + 1);
      check(label + " " + width + "显示可访问的页面主体", await page.locator("main").count() > 0);
      if (label === "profile") {
        check("改密与退款后页面含当前账号", (await page.locator("body").innerText()).includes(actor.user.id));
        const balances = page.getByRole("definition");
        check(width + "页面显示最终赠送与购买来源余额", (await balances.allTextContents()).some(text => text.includes(final.balance.gift.available)) && (await balances.allTextContents()).some(text => text.includes("可用 0") && text.includes("预留 0")));
      }
      const filename = "release-" + width + "-" + label + ".png";
      await page.screenshot({ path: join(output, filename), fullPage: true }); screenshots.push(filename);
    }
    check(width + "无页面运行异常", errors.length === 0); await context.close();
  }
  workflows.push("desktop-and-narrow-profile-workspace");
} catch (error) { if (!assertions.at(-1) || assertions.at(-1).okay) { fail++; assertions.push({ name: error.message, okay: false }); } console.error("❌ " + error.message); }
finally {
  try { await fixtureRequest("/clock-reset", {}); cleanup.clockReset = true; } catch { fail++; assertions.push({ name: "隔离时钟清理失败", okay: false }); }
  await browser?.close(); for (const http of clients) await http.dispose();
  await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, workflows, assertions, responses, screenshots, financialSnapshots, recoveryRuns, cleanup, coverageLimitations, implementationBase: "1165f8a34e0013c95dec504e785b02d980f79e9a", aiMode: "replay", realLlmCostCny: "0", realFundsCny: "0" }, null, 2));
}
console.log("组合结果：" + pass + "通过，" + fail + "失败"); process.exitCode = fail > 0 ? 1 : 0;
