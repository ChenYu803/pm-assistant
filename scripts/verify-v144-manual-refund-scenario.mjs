// v1.44 #12：只通过正式 HTTP 造充值/赠送/模型消耗；literal 账单与持久查询断言。
// SQL 故障与账号锁只走隔离 runner IPC；没有退款/预留/结算内部函数调用。
import { request } from "playwright-core";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { requestRegistrationCode } from "./verify-email-fixture.mjs";

let base = process.env.BASE_URL;
const output = process.env.V141_REPLAY_OUTPUT_DIR;
const clients = [], assertions = [], workflows = [], responses = [], observations = [];
const selected = new Set(process.env.V144_REFUND_WORKFLOW?.split(",").filter(Boolean));
let pass = 0, fail = 0, current = "initializing", admin, secondAdmin;
function check(name, okay, actual) {
  assertions.push({ workflow: current, name, okay: Boolean(okay), ...(!okay ? { actual } : {}) });
  console.log((okay ? "✅ " : "❌ ") + name);
  if (okay) pass++; else fail++;
}
function must(name, okay, actual) {
  check(name, okay, actual);
  if (!okay) { const error = new Error(name); error.counted = true; throw error; }
}
async function progress() { await writeFile(join(output, "scenario-progress.json"), JSON.stringify({ current, pass, fail, workflows, at: new Date().toISOString() }, null, 2)); }
async function section(name, run) {
  if (!selected.has(name)) return;
  current = name; await progress(); const before = fail;
  try { await run(); } catch (error) { if (!error.counted) check(name + "：" + error.message, false); }
  if (fail === before) workflows.push(name);
  await progress();
}
async function call(actor, path, data, status = 200, method = data === undefined ? "GET" : "POST", options = {}) {
  const response = await actor.http.fetch(base + path, { method, ...(data !== undefined ? { data } : {}), ...options });
  const raw = await response.text(); let body; try { body = JSON.parse(raw); } catch { body = { snippet: raw.slice(0, 240) }; }
  responses.push({ workflow: current, method, path, status: response.status(), body });
  must(method + " " + path.split("?")[0] + " HTTP " + status, response.status() === status, { actual: response.status(), body });
  return body;
}
async function client(email = "refund-" + randomUUID() + "@test.local") {
  const http = await request.newContext({ timeout: 90000 }); clients.push(http);
  if (email === null) return { http };
  const password = "refund-isolated-12345";
  const code = await requestRegistrationCode(http, email);
  await call({ http }, "/api/auth/register", { email, password, code }, 201);
  const { csrfToken } = await call({ http }, "/api/auth/csrf");
  await http.post(base + "/api/auth/callback/credentials", { form: { email, password, csrfToken, callbackUrl: base + "/projects" }, headers: { "X-Auth-Return-Redirect": "1" } });
  const { user } = await call({ http }, "/api/auth/session");
  must("正式登录邮箱及账号身份一致", user?.email === email && !!user.id);
  return { http, user, email };
}
const operation = (actor, entry, refundRmb = "2.34", extra = {}) => ({ accountId: actor.user.id, rechargeEntryId: entry.id, requestId: randomUUID(), refundRmb, reason: "隔离人工退款验收", ...extra });
async function recharge(actor, paidRmb = "12.34", operator = admin) {
  return (await call(operator, "/api/admin/recharges", { accountId: actor.user.id, requestId: randomUUID(), paidRmb, receiptReference: "IN-" + randomUUID(), reason: "隔离退款原实付" })).entry;
}
async function grant(actor, amount) { return call(admin, "/api/admin/users/" + actor.user.id + "/credits", { requestId: randomUUID(), type: "grant", amount, reason: "隔离赠送不可退款" }); }
const statement = actor => call(actor, "/api/credits");
const sources = actor => call(admin, "/api/admin/refunds/sources?accountId=" + actor.user.id);
async function source(actor, entry) { return (await sources(actor)).sources.find(row => row.rechargeEntryId === entry.id); }
async function lookup(id, operator = admin) { return (await call(operator, "/api/admin/refunds?q=" + id)).refunds.find(row => row.id === id); }
const initiate = (input, operator = admin, status = 200) => call(operator, "/api/admin/refunds", input, status);
const action = (id, value, operator = admin, status = 200) => call(operator, "/api/admin/refunds/" + id, value, status, "PATCH");
const confirmed = (id, reference = "OUT-" + randomUUID(), operator = admin) => action(id, { action: "confirm-transfer", externalReference: reference, reason: "隔离外部成功已核实" }, operator);
const failed = (id, operator = admin) => action(id, { action: "mark-failed", reason: "隔离已核实未转账" }, operator);
function lifecycle(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { process.off("message", listener); reject(Error("隔离 IPC 超时：" + type)); }, 60000);
    function listener(message) { if (message?.type !== type) return; clearTimeout(timer); process.off("message", listener); if (message.error) reject(Error(message.error)); else resolve(message); }
    process.on("message", listener); process.send({ type, ...payload });
  });
}
async function poll(read, predicate, ms = 15000) {
  const end = Date.now() + ms; let value;
  do { value = await read(); if (predicate(value)) return value; await delay(80); } while (Date.now() < end);
  throw Error("等待可观察状态超时：" + JSON.stringify(value).slice(0, 500));
}
async function fixture(path, data) {
  const response = await fetch(new URL(path, process.env.V144_PROVIDER_FIXTURE_URL), { method: data ? "POST" : "GET", ...(data ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}) });
  if (!response.ok) throw Error("本机供应商替身控制失败"); return response.json();
}
async function work(actor) {
  const project = await call(actor, "/api/projects", { name: "人工退款并发验收" }, 201);
  const iteration = await call(actor, "/api/projects/" + project.id + "/iterations", { displayName: "退款验收" }, 201);
  const { session } = await call(actor, "/api/iterations/" + iteration.id + "/stages/analysis/sessions", {}, 201);
  return { actor, project, iteration, session, path: "/api/iterations/" + iteration.id + "/stages/analysis/sessions/" + session.id + "/messages" };
}
async function generate(target, mode = "normal") {
  await fixture("/control", { mode });
  return modelResult(await call(target.actor, target.path, { content: "人工退款模型计费验收", requestId: randomUUID() }));
}
// 对话的计费与候选属于持久 assistant 消息；润色响应才在顶层提供 creditCall。
function modelResult(body) {
  const assistant = body.messages?.find(row => row.id === body.assistantMessage?.id);
  return { ...body, creditCall: assistant?.creditCall ?? body.creditCall };
}
async function peak(callResult) {
  callResult = modelResult(callResult);
  const rows = await call(admin, "/api/admin/model-requests?q=" + callResult.creditCall.id);
  const row = rows.requests.find(value => value.id === callResult.creditCall.id);
  must("模型为本机已确认价格及真实持久用量", row?.price?.fixture === true && typeof row.price.start?.peak === "boolean");
  return row.price.start.peak;
}
async function lockedTogether(actor, requests) {
  await lifecycle("refund-account-lock", { userId: actor.user.id });
  const pending = requests.map(start => start());
  // 先注册 rejection handler，避免锁等待期间出现未处理 rejection。
  const settled = Promise.allSettled(pending);
  try {
    const waiting = await poll(() => lifecycle("refund-account-lock", { userId: actor.user.id, inspect: true }), result => result.waiters >= requests.length, 20000);
    observations.push({ workflow: current, barrier: "account-lock", requests: requests.length, ...waiting });
    check("账号锁屏障证实全部并发事务已进入等待", waiting.waiters >= requests.length, waiting);
  } finally { await lifecycle("refund-account-unlock", { userId: actor.user.id }); }
  const results = await settled;
  for (const result of results) if (result.status === "rejected") throw result.reason;
  return results.map(result => result.value);
}

try {
  must("拒绝非隔离库或远端供应商", /^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE ?? "") && /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(process.env.V144_PROVIDER_FIXTURE_URL ?? "") && selected.size > 0);
  admin = await client(process.env.V144_ADMIN_EMAIL);
  secondAdmin = await client(process.env.V144_SECOND_ADMIN_EMAIL);

  await section("lifecycle", async () => {
    const actor = await client(), entry = await recharge(actor);
    const before = await statement(actor);
    check("首条独立充值账单：12.34 元=12340 购买积分", before.balance.purchased.available === "12340" && before.accountId === actor.user.id && before.entries.some(row => row.id === entry.id));
    const input = operation(actor, entry), result = await initiate(input), refund = result.refund;
    must("首条正式 HTTP 退款关联账号/原充值/来源/请求与操作者", !result.replayed && !!refund.id && refund.accountId === actor.user.id && refund.rechargeEntryId === entry.id && !!refund.sourceId && refund.requestId === input.requestId && refund.actorId === admin.user.id && refund.actorEmail === admin.email && refund.accountEmail === actor.email, refund);
    check("首条独立退款账单：2.34 元=2340，初态 unverified/held", refund.refundRmb === "2.34" && refund.credits === "2340" && refund.transferStatus === "unverified" && refund.accountingStatus === "held");
    const held = await statement(actor), src = await source(actor, entry);
    check("首条用户持久账本：available10000/refundHeld2340/model reserved0", held.balance.purchased.available === "10000" && held.refundHeld === "2340" && held.balance.purchased.reserved === "0" && held.balance.gift.reserved === "0");
    check("首条来源持久守恒：原12340=可用10000+退款占用2340", src.originalCredits === "12340" && src.available === "10000" && src.refundHeld === "2340" && src.reserved === "0" && src.refundableRmb === "10" && src.remainingPaidRmb === "10" && src.sourceId === refund.sourceId, src);
    const read = await lookup(refund.id), own = await call(actor, "/api/refunds?page=1");
    check("后台/用户查询持久同一退款及初态", read?.id === refund.id && own.refunds.some(row => row.id === refund.id && row.accountingStatus === "held") && held.refunds.some(row => row.id === refund.id));
    await action(refund.id, { action: "complete", reason: "外部未知不得直接扣账" }, admin, 409);
    const done = await confirmed(refund.id);
    check("外部确认后完成内部扣账", done.refund.transferStatus === "succeeded" && done.refund.accountingStatus === "completed");
    const after = await statement(actor), finalSource = await source(actor, entry);
    check("首条最终用户及来源守恒：已退2340、可用10000、两种冻结0", after.balance.purchased.available === "10000" && after.refundHeld === "0" && after.balance.purchased.reserved === "0" && finalSource.available === "10000" && finalSource.refundHeld === "0" && finalSource.remainingPaidRmb === "10");
    for (const type of ["manual_refund_hold", "manual_refund_transfer", "manual_refund"]) {
      const rows = after.entries.filter(row => row.businessType === type);
      check("首条审计唯一且关联原退款：" + type, rows.length === 1 && rows[0].context.refundId === refund.id && rows[0].context.rechargeEntryId === entry.id && rows[0].actorId === admin.user.id && (type !== "manual_refund" || rows[0].amount === "-2340"));
    }
    const replay = await initiate(input);
    check("原 requestId 在完成后仍返回原终态退款", replay.replayed && replay.refund.id === refund.id && replay.refund.accountingStatus === "completed");
    const next = await initiate(operation(actor, entry));
    check("完成后相同金额/原因的新 requestId 可合法再次部分退款", !next.replayed && next.refund.id !== refund.id);
    const again = await confirmed(next.refund.id), last = await statement(actor), lastSrc = await source(actor, entry);
    check("第二次部分退款独立 literal：7660 可用/4.68 已退/7.66 余款", again.refund.accountingStatus === "completed" && last.balance.purchased.available === "7660" && lastSrc.remainingPaidRmb === "7.66" && lastSrc.refundableRmb === "7.66");
    observations.push({ name: "first-http-lifecycle", input, refund, held, src, after, lastSrc });
  });

  await section("permissions-validation", async () => {
    const actor = await client(), other = await client(), anon = await client(null), entry = await recharge(actor), input = operation(actor, entry);
    for (const [operator, status] of [[anon, 401], [actor, 403]]) {
      await initiate(input, operator, status);
      await call(operator, "/api/admin/refunds", undefined, status);
      await call(operator, "/api/admin/refunds/sources?accountId=" + actor.user.id, undefined, status);
      await action(randomUUID(), { action: "complete", reason: "越权" }, operator, status);
    }
    await call(anon, "/api/refunds", undefined, 401);
    await call(actor, "/api/refunds?accountId=" + other.user.id, undefined, 400);
    await call(actor, "/api/credits?accountId=" + other.user.id, undefined, 400);
    await initiate({ ...input, accountId: other.user.id }, admin, 404);
    for (const amount of ["0", "-1", "1.001", "1e2", "01.00", "NaN", 1, "1000000000.00"]) await initiate({ ...input, requestId: randomUUID(), refundRmb: amount }, admin, 400);
    for (const extra of [{ accountId: "bad" }, { rechargeEntryId: "bad" }, { requestId: "bad" }, { reason: " " }, { reason: "字".repeat(501) }, { amount: "2340" }, { accountingStatus: "completed" }]) await initiate({ ...input, ...extra }, admin, 400);
    await call(admin, "/api/admin/refunds", input, 403, "POST", { headers: { Origin: "https://evil.invalid" } });
    await initiate({ ...input, refundRmb: "12.35" }, admin, 409);
    const created = (await initiate(input)).refund;
    for (const value of [{ action: "invalid", reason: "核实" }, { action: "complete", reason: " " }, { action: "confirm-transfer", reason: "核实" }, { action: "confirm-transfer", reason: "核实", externalReference: "中文号" }, { action: "complete", reason: "核实", externalReference: "NEW" }, { action: "mark-failed", reason: "字".repeat(501) }, { action: "mark-failed", reason: "核实", amount: "1" }]) await action(created.id, value, admin, 400);
    await action(created.id, { action: "mark-failed", reason: "越权" }, other, 403);
    for (const path of ["/api/refunds?page=0", "/api/refunds?page=1.2", "/api/admin/refunds?page=0", "/api/admin/refunds?accountId=" + actor.user.id, "/api/admin/refunds/sources?accountId=" + actor.user.id + "&page=0"]) await call(path.startsWith("/api/admin") ? admin : actor, path, undefined, 400);
    const otherList = await call(other, "/api/refunds"), own = await statement(actor);
    check("权限/校验失败不跨账号泄漏，且退款仅占用一次", otherList.total === 0 && own.balance.purchased.available === "10000" && own.refundHeld === "2340");
    const giftActor = await client(), gift = await grant(giftActor, "12340");
    const giftEntry = (await statement(giftActor)).entries.find(row => row.businessType === "admin_grant");
    must("赠送由正式 HTTP 创建独立账单", !!gift && !!giftEntry);
    await initiate(operation(giftActor, giftEntry), admin, 404);
    check("仅赠送没有购买来源，不可折现", (await sources(giftActor)).total === 0 && (await statement(giftActor)).balance.gift.available === "12340");
  });

  await section("idempotency", async () => {
    const actor = await client(), other = await client(), entry = await recharge(actor), entry2 = await recharge(actor, "1.00"), otherEntry = await recharge(other, "12.34"), input = operation(actor, entry);
    const results = await lockedTogether(actor, [() => initiate(input), () => initiate(input), () => initiate({ ...input, requestId: randomUUID() }, secondAdmin)]);
    const id = results[0].refund.id;
    check("同来源多管理员并发只冻结一笔，恰有一条首次结果", new Set(results.map(row => row.refund.id)).size === 1 && results.filter(row => row.replayed === false).length === 1);
    const replay = await initiate({ ...input, requestId: randomUUID() });
    check("待完成同内容不同 requestId 重放原退款", replay.replayed && replay.refund.id === id);
    for (const operator of [admin, secondAdmin]) await initiate({ ...input, requestId: randomUUID(), reason: "内容不同" }, operator, 409);
    // 找到实际创建者，以该操作者复用原请求身份，避免并发赢家不同使断言失真。
    const original = results.find(row => !row.replayed).refund, creator = original.actorId === admin.user.id ? admin : secondAdmin;
    await initiate({ ...operation(other, otherEntry), requestId: original.requestId }, creator, 409);
    await initiate({ ...operation(actor, entry2, "0.01"), requestId: original.requestId }, creator, 409);
    const independent = await initiate(operation(actor, entry2, "0.50"));
    check("同账号不同原充值分别冻结，不借另一来源可退金额", independent.refund.sourceId !== original.sourceId && (await source(actor, entry2)).available === "500" && (await source(actor, entry)).available === "10000");
    const reference = "OUT-SHARED-" + randomUUID(); await confirmed(id, reference);
    await action(independent.refund.id, { action: "confirm-transfer", reason: "隔离外部成功已核实", externalReference: reference.toLowerCase() }, secondAdmin, 409);
    const still = await lookup(independent.refund.id);
    check("全局外部成功参考号冲突，第二笔不确认不扣账", still.transferStatus === "unverified" && still.accountingStatus === "held" && (await source(actor, entry2)).refundHeld === "500");
    await confirmed(independent.refund.id);
    check("重复/冲突后来源守恒 literal：10500 可用且两笔完成", (await statement(actor)).balance.purchased.available === "10500" && (await statement(actor)).refundHeld === "0");

  });

  await section("identity-request", async () => {
    // 原笔完成后，已接受过的客户端别名仍代表原笔；不能再次锁定可用积分。
    for (const [label, aliasOperator] of [["同管理员", admin], ["跨管理员", secondAdmin]]) {
      const aliasActor = await client(), aliasEntry = await recharge(aliasActor);
      const originalInput = operation(aliasActor, aliasEntry);
      const originalRefund = (await initiate(originalInput)).refund;
      const aliasInput = { ...originalInput, requestId: randomUUID() };
      // 首次请求已提交，但客户端不使用响应；后续只能凭保留的别名请求身份恢复。
      await initiate(aliasInput, aliasOperator);
      const held = await lookup(originalRefund.id);
      check(label + "别名首次请求已提交，原退款仍 held", held.accountingStatus === "held" && held.transferStatus === "unverified");
      await confirmed(originalRefund.id);
      const retried = await initiate(aliasInput, aliasOperator), afterAlias = await statement(aliasActor);
      check("P1 别名终态重试：" + label + "返回原 id/completed，零二次冻结",
        retried.replayed === true && retried.refund.id === originalRefund.id && retried.refund.accountingStatus === "completed" && retried.refund.transferStatus === "succeeded" && afterAlias.refundHeld === "0" && afterAlias.balance.purchased.available === "10000",
        { expected: { id: originalRefund.id, replayed: true, accountingStatus: "completed", transferStatus: "succeeded", refundHeld: "0", available: "10000" }, actual: { id: retried.refund.id, replayed: retried.replayed, accountingStatus: retried.refund.accountingStatus, transferStatus: retried.refund.transferStatus, refundHeld: afterAlias.refundHeld, available: afterAlias.balance.purchased.available }, requestId: aliasInput.requestId });
    }

    // requestId 的操作者身份由全局账本共享，充值/赠送身份不得用于创建退款。
    for (const kind of ["manual_recharge", "admin_grant"]) {
      const identityActor = await client(), paidEntry = await recharge(identityActor);
      const priorEntry = kind === "manual_recharge" ? paidEntry : (await grant(identityActor, "100")).entry;
      must("P2 " + kind + "已有正式 HTTP 审计请求身份", typeof priorEntry?.requestId === "string", priorEntry);
      const reused = operation(identityActor, paidEntry, "2.34", { requestId: priorEntry.requestId });
      const response = await admin.http.post(base + "/api/admin/refunds", { data: reused });
      const body = await response.json();
      responses.push({ workflow: current, method: "POST", path: "/api/admin/refunds", status: response.status(), body });
      const afterIdentity = await statement(identityActor);
      check("P2 全局 requestId：复用 " + kind + " 必须 409 且零退款占用",
        response.status() === 409 && afterIdentity.refundHeld === "0" && afterIdentity.balance.purchased.available === "12340",
        { expected: { status: 409, refundHeld: "0", available: "12340" }, actual: { status: response.status(), refundHeld: afterIdentity.refundHeld, available: afterIdentity.balance.purchased.available, body }, requestId: priorEntry.requestId });
    }
  });

  await section("transfer-failure", async () => {
    const actor = await client(), entry = await recharge(actor), input = operation(actor, entry), { refund } = await initiate(input);
    const released = await failed(refund.id, secondAdmin), again = await failed(refund.id, secondAdmin);
    check("明确未转账可由另一管理员原子释放且重复幂等", released.refund.transferStatus === "failed" && released.refund.accountingStatus === "released" && again.replayed && again.refund.id === refund.id);
    await action(refund.id, { action: "complete", reason: "失败不可扣账" }, admin, 409);
    await action(refund.id, { action: "confirm-transfer", reason: "失败不可翻转", externalReference: "OUT-" + randomUUID() }, admin, 409);
    const own = await statement(actor), src = await source(actor, entry);
    check("失败完整释放 literal：12340 可用/0冻结/12.34 可退", own.balance.purchased.available === "12340" && own.refundHeld === "0" && src.available === "12340" && src.refundableRmb === "12.34");
    check("失败审计仅一条 release，零实际退款", own.entries.filter(row => row.businessType === "manual_refund_release").length === 1 && !own.entries.some(row => row.businessType === "manual_refund"));
    check("失败后原 requestId 仍指向已释放原记录", (await initiate(input)).refund.id === refund.id);
    check("失败后新 requestId 可以重新申请", !(await initiate(operation(actor, entry))).replayed);
  });

  await section("internal-failure-restart", async () => {
    const actor = await client(), entry = await recharge(actor), { refund } = await initiate(operation(actor, entry)), reference = "OUT-FAULT-" + randomUUID();
    await lifecycle("refund-write-fault");
    try {
      const result = await confirmed(refund.id, reference);
      check("只失败内部扣账仍 HTTP200，并明确 warning 与 succeeded/held", !!result.warning && result.refund.transferStatus === "succeeded" && result.refund.accountingStatus === "held", result);
      const read = await lookup(refund.id, secondAdmin), own = await statement(actor), src = await source(actor, entry);
      check("外部成功已被其他请求持久读取，冻结不可消费", read.transferStatus === "succeeded" && read.externalReference === reference.toUpperCase() && own.refundHeld === "2340" && own.balance.purchased.available === "10000" && src.refundHeld === "2340");
      check("内部事务回滚，不留下实际扣账流水", !own.entries.some(row => row.businessType === "manual_refund") && own.entries.filter(row => row.businessType === "manual_refund_transfer").length === 1);
      await action(refund.id, { action: "mark-failed", reason: "不得释放外部已成功的冻结" }, secondAdmin, 409);
      const retried = await confirmed(refund.id, reference);
      check("外部确认重试仍只报告待内账，未二次转账或扣分", retried.refund.id === refund.id && retried.refund.accountingStatus === "held" && !!retried.warning);
      await action(refund.id, { action: "complete", reason: "内部故障仍存在" }, admin, 503);
      const restarted = await lifecycle("restart-credit-app"); base = restarted.base; process.env.BASE_URL = base;
      const persisted = await lookup(refund.id);
      check("进程重启后可查询 succeeded/held 原退款", persisted.id === refund.id && persisted.transferStatus === "succeeded" && persisted.accountingStatus === "held");
    } finally { await lifecycle("refund-clear-fault"); }
    const completed = await action(refund.id, { action: "complete", reason: "只恢复内部记账" }, secondAdmin);
    const repeat = await action(refund.id, { action: "complete", reason: "再次安全恢复" }, admin), own = await statement(actor);
    check("重启清故障后 complete 安全恢复且重复不扣", completed.refund.accountingStatus === "completed" && repeat.replayed && own.refundHeld === "0" && own.balance.purchased.available === "10000" && own.entries.filter(row => row.businessType === "manual_refund").length === 1);
  });

  await section("response-loss", async () => {
    const actor = await client(), entry = await recharge(actor), input = operation(actor, entry);
    // 服务器真实提交后在 HTTP 客户端交付边界丢弃响应，随后同身份重试；不改业务响应。
    const lost = await admin.http.post(base + "/api/admin/refunds", { data: input });
    must("丢失前服务器已接受 HTTP 请求", lost.status() === 200); await lost.dispose();
    const recovered = await initiate(input);
    check("申请响应未交付后同 requestId 重放，不重复占用", recovered.replayed && (await statement(actor)).refundHeld === "2340");
    const command = { action: "confirm-transfer", reason: "已核实外部完成", externalReference: "OUT-LOST-" + randomUUID() };
    const lostConfirm = await admin.http.patch(base + "/api/admin/refunds/" + recovered.refund.id, { data: command });
    must("外部确认响应丢失前服务器已接受", lostConfirm.status() === 200); await lostConfirm.dispose();
    const again = await action(recovered.refund.id, command), own = await statement(actor);
    check("确认响应未交付后重试唯一终态和唯一扣账", again.replayed && again.refund.accountingStatus === "completed" && own.balance.purchased.available === "10000" && own.refundHeld === "0" && own.entries.filter(row => row.businessType === "manual_refund").length === 1);
  });

  await section("pagination-query", async () => {
    const actor = await client(), other = await client(), entry = await recharge(actor, "1.00"), ids = [];
    for (let i = 0; i < 21; i++) { const { refund } = await initiate(operation(actor, entry, "0.01", { reason: "分页独立账单" })); ids.push(refund.id); await confirmed(refund.id); }
    const first = await call(admin, "/api/admin/refunds?q=" + actor.user.id + "&page=1"), second = await call(admin, "/api/admin/refunds?q=" + actor.user.id + "&page=2");
    const user1 = await call(actor, "/api/refunds?page=1"), user2 = await call(actor, "/api/refunds?page=2"), own = await statement(actor);
    check("后台分页21笔为20+1且不重叠", first.total === 21 && first.pageSize === 20 && first.refunds.length === 20 && second.page === 2 && second.refunds.length === 1 && new Set([...first.refunds, ...second.refunds].map(row => row.id)).size === 21);
    check("用户分页与首页首20/总数持久一致", user1.total === 21 && user1.refunds.length === 20 && user2.refunds.length === 1 && own.refundTotal === 21 && own.refunds.length === 20 && own.balance.purchased.available === "790");
    for (const q of [actor.user.id, actor.email, entry.id, ids[0]]) {
      const result = await call(admin, "/api/admin/refunds?q=" + encodeURIComponent(q));
      check("完整账号/邮箱/充值/退款筛选：" + q, result.total === (q === ids[0] ? 1 : 21) && result.refunds.every(row => row.accountId === actor.user.id));
    }
    const oldest = await lookup(ids[0]), byReference = await call(admin, "/api/admin/refunds?q=" + oldest.externalReference.toLowerCase());
    check("外部参考号大小写归一精确查询", byReference.total === 1 && byReference.refunds[0].id === oldest.id);
    check("跨账号用户分页隔离且无结果不泄漏", (await call(other, "/api/refunds")).total === 0 && (await call(admin, "/api/admin/refunds?q=absent-" + randomUUID())).total === 0);
    // 来源列表亦超过一页；只通过正式充值创建。
    for (let i = 0; i < 20; i++) await recharge(actor, "0.01");
    const source1 = await sources(actor), source2 = await call(admin, "/api/admin/refunds/sources?accountId=" + actor.user.id + "&page=2");
    check("购买来源分页21笔为20+1且原充值不丢失", source1.total === 21 && source1.sources.length === 20 && source2.sources.length === 1 && new Set([...source1.sources, ...source2.sources].map(row => row.sourceId)).size === 21);
  });

  await section("model-fraction", async () => {
    const actor = await client(), entry = await recharge(actor, "1.00"), target = await work(actor), generated = await generate(target, "tiny"), isPeak = await peak(generated);
    check("HTTP模型消费非整分积分，literal 0.02/0.01", generated.creditCall.consumed === (isPeak ? "0.02" : "0.01"));
    const src = await source(actor, entry);
    check("来源非整分消耗后退款金额下取整为0.99，绝不四舍五入1元", src.available === (isPeak ? "999.98" : "999.99") && src.refundableRmb === "0.99" && src.remainingPaidRmb === "1");
    await initiate(operation(actor, entry, "1.00"), admin, 409);
    const { refund } = await initiate(operation(actor, entry, "0.99")); await confirmed(refund.id);
    const after = await statement(actor), remainder = await source(actor, entry);
    check("退款与消费及尾差守恒 literal：剩9.98/9.99积分、可退0", after.balance.purchased.available === (isPeak ? "9.98" : "9.99") && remainder.remainingPaidRmb === "0.01" && remainder.refundableRmb === "0" && after.refundHeld === "0");
  });

  await section("model-exhausted", async () => {
    const actor = await client(), first = await recharge(actor, "0.01"), second = await recharge(actor, "2.00"), target = await work(actor);
    let isPeak;
    for (let i = 0; i < 5; i++) { const generated = await generate(target); const window = await peak(generated); if (isPeak === undefined) isPeak = window; must("五次消费在同一价格窗口且按独立固定账单", window === isPeak && generated.creditCall.consumed === (isPeak ? "4.032" : "2.016")); }
    const src = await source(actor, first), other = await source(actor, second);
    check("原0.01元来源已被模型全部消费、另一来源仍有余额", src.available === "0" && src.reserved === "0" && src.refundableRmb === "0" && other.available === (isPeak ? "1989.84" : "1999.92"), { src, other });
    await initiate(operation(actor, first, "0.01"), admin, 409);
    check("全部已消费不可借另一来源退款", (await statement(actor)).refundHeld === "0");
  });

  await section("model-protection", async () => {
    const actor = await client(), entry = await recharge(actor, "2.00"), target = await work(actor);
    const beforeCount = (await fixture("/stats")).count, full = await initiate(operation(actor, entry, "2.00"));
    await call(actor, target.path, { content: "退款冻结不得被消费", requestId: randomUUID() }, 402);
    check("全部退款冻结时模型被拦截且供应商调用0增量", (await fixture("/stats")).count === beforeCount && (await statement(actor)).refundHeld === "2000");
    await failed(full.refund.id);
    await fixture("/control", { mode: "hold" });
    const count = (await fixture("/stats")).count;
    const running = call(actor, target.path, { content: "预留不得被退款", requestId: randomUUID() });
    const guarded = Promise.allSettled([running]);
    await poll(() => fixture("/stats"), value => value.count === count + 1 && !value.calls.at(-1).closed);
    const held = await statement(actor), src = await source(actor, entry);
    must("供应商屏障期间购买模型预留确已持久存在", Number(held.balance.purchased.reserved) > 0 && Number(src.reserved) > 0 && held.refundHeld === "0", held);
    await initiate(operation(actor, entry, "2.00"), admin, 409);
    const partial = await initiate(operation(actor, entry, "0.01"));
    const during = await statement(actor);
    check("模型预留中仍可退未占用部分，退款冻结与模型预留分离", during.refundHeld === "10" && during.balance.purchased.reserved === held.balance.purchased.reserved);
    const [result] = await guarded; if (result.status === "rejected") throw result.reason;
    const isPeak = await peak(result.value), after = await statement(actor);
    check("模型结算不动退款冻结：可用1985.968/1987.984、held10、reserved0", after.refundHeld === "10" && after.balance.purchased.reserved === "0" && after.balance.purchased.available === (isPeak ? "1985.968" : "1987.984"));
    await failed(partial.refund.id);
  });

  await section("concurrent-account", async () => {
    const actor = await client(), entry = await recharge(actor, "20.00"), target = await work(actor), generated = await generate(target, "context-document"), isPeak = await peak(generated);
    const candidate = generated.messages.find(row => row.id === generated.assistantMessage.id)?.candidate;
    must("正式模型生成候选文件", !!candidate?.id);
    await call(actor, "/api/iterations/" + target.iteration.id + "/sessions/" + target.session.id + "/candidates/" + candidate.id, { action: "write", filename: "需求分析-退款并发.md", expectedOperation: "create" });
    const files = await call(actor, "/api/projects/" + target.project.id + "/files"), file = files.find(row => row.filename === "需求分析-退款并发.md");
    must("显式候选写入产生持久文件", !!file?.id);
    const { session } = await call(actor, "/api/iterations/" + target.iteration.id + "/stages/analysis/sessions", {}, 201);
    const stagePath = "/api/iterations/" + target.iteration.id + "/stages/analysis/sessions/" + session.id + "/messages";
    await fixture("/control", { mode: "hold" }); await fixture("/control", { mode: "hold" });
    const results = await lockedTogether(actor, [
      () => recharge(actor, "1.00", secondAdmin),
      () => initiate(operation(actor, entry, "1.00")),
      () => call(actor, stagePath, { content: "并发模型对话", requestId: randomUUID() }),
      () => call(actor, "/api/projects/" + target.project.id + "/files/" + file.id + "/polish", { content: "并发退款与润色", requestId: randomUUID() }),
    ]);
    check("四类并发公开请求均成功，模型按独立账单消费", results[1].refund.accountingStatus === "held" && modelResult(results[2]).creditCall.consumed === (isPeak ? "4.032" : "2.016") && results[3].creditCall.consumed === (isPeak ? "4.032" : "2.016"));
    const own = await statement(actor), src = await source(actor, entry);
    check("充值+退款+对话+润色守恒 literal：19987.904/19993.952可用、held1000、reserved0", own.balance.purchased.available === (isPeak ? "19987.904" : "19993.952") && own.refundHeld === "1000" && own.balance.purchased.reserved === "0" && src.refundHeld === "1000", own);
    await confirmed(results[1].refund.id);
    check("并发后完成只扣本笔held，可用余额保持，另充值来源1000完整", (await statement(actor)).refundHeld === "0" && (await source(actor, results[0])).available === "1000");
  });
  current = "coverage";
  check("实际 workflows 与筛选预期逐项一致，空跑不得成功", workflows.length === selected.size && [...selected].every(name => workflows.includes(name)));
} catch (error) {
  if (!error.counted) check("场景初始化/执行失败：" + error.message, false);
} finally {
  for (const http of clients) try { await http.dispose(); } catch (error) { check("HTTP上下文清理：" + error.message, false); }
  await progress();
  await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, workflows, expectedWorkflows: [...selected], assertions, responses, observations, aiMode: "replay", realFunds: 0, realModelCalls: 0, modelBoundary: "local-http-fixture" }, null, 2));
}
console.log("结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);
