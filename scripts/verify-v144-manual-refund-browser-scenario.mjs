// v1.44 #12：真实 UI 退款闭环；响应故障仅在正式 HTTP 已提交后注入。
// 旧草稿仅写 sessionStorage；服务端状态与余额始终来自正式 HTTP。
import { chromium } from "playwright-core";
import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { requestRegistrationCode } from "./verify-email-fixture.mjs";

const base = process.env.BASE_URL, output = process.env.V141_REPLAY_OUTPUT_DIR;
if (!base || !output || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || !process.send) throw Error("仅允许隔离 runner 启动本机浏览器场景");
const identities = new Map();
const assertions = [], workflows = [], responses = [], screenshots = [], layouts = [], pageerrors = [], contexts = [];
let pass = 0, fail = 0, current = "初始化", browser, browserExecutable;
function check(name, okay, actual) {
  assertions.push({ workflow: current, name, okay: Boolean(okay), ...(!okay ? { actual } : {}) });
  console.log((okay ? "✅ " : "❌ ") + name);
  if (okay) pass++; else fail++;
}
function must(name, okay, actual) {
  check(name, okay, actual);
  if (!okay) { const error = Error(name); error.counted = true; throw error; }
}
async function poll(read, predicate, label, timeout = 15000) {
  const end = Date.now() + timeout;
  let value;
  do { value = await read(); if (predicate(value)) return value; await delay(100); } while (Date.now() < end);
  throw Error(label + "超时：" + JSON.stringify(value).slice(0, 400));
}
async function progress() {
  await writeFile(join(output, "scenario-progress.json"), JSON.stringify({ current, pass, fail, workflows, at: new Date().toISOString() }, null, 2));
}
async function section(name, run) {
  current = name; await progress(); const before = fail;
  try { await run(); } catch (error) {
    if (!error.counted) check(name + "：" + error.message, false);
    for (const context of contexts) for (const page of context.pages()) {
      if (!page.isClosed()) await shot(page, "failure-" + name + "-" + screenshots.length).catch(() => {});
    }
  }
  if (before === fail) workflows.push(name);
  await progress();
}
async function call(actor, path, data, expected = 200, method = data === undefined ? "GET" : "POST") {
  const response = await actor.context.request.fetch(base + path, { method, ...(data === undefined ? {} : { data }) });
  const body = await response.json();
  responses.push({ workflow: current, method, path, status: response.status(), body });
  if (response.status() !== expected) throw Error(method + " " + path + " HTTP " + response.status() + " " + JSON.stringify(body));
  return body;
}
function lifecycle(type) {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => { process.off("message", listener); reject(Error("IPC 超时：" + type)); }, 60000);
    function listener(message) {
      if (message?.type !== type) return;
      clearTimeout(timer); process.off("message", listener);
      if (message.error) reject(Error(message.error)); else resolveMessage(message);
    }
    process.on("message", listener); process.send({ type });
  });
}
async function client(email, viewport) {
  const known = identities.get(email);
  const context = await browser.newContext({ baseURL: base, viewport, ...(known ? { storageState: known.state } : {}) }); contexts.push(context);
  context.setDefaultTimeout(20000); context.setDefaultNavigationTimeout(60000);
  context.on("page", page => page.on("pageerror", error => pageerrors.push({ workflow: current, url: page.url(), message: error.message })));
  const actor = { context }, password = "refund-browser-12345";
  if (!known) {
  const code = await requestRegistrationCode(context.request, email);
  await call(actor, "/api/auth/register", { email, password, code }, 201);
  const { csrfToken } = await call(actor, "/api/auth/csrf");
  await context.request.post(base + "/api/auth/callback/credentials", { form: { email, password, csrfToken, callbackUrl: base + "/projects" }, headers: { "X-Auth-Return-Redirect": "1" } });
  }
  const session = await call(actor, "/api/auth/session");
  must("正式登录身份一致 " + email, session.user?.email === email && !!session.user.id);
  identities.set(email, { state: await context.storageState() });
  actor.user = session.user; actor.page = await context.newPage(); return actor;
}
async function shot(page, name) {
  const path = join(output, "screenshots", name + ".png");
  await page.screenshot({ path, fullPage: true, timeout: 20000 }); screenshots.push(path); return path;
}
async function visual(page, name, regionName) {
  const region = page.getByRole("region", { name: regionName, exact: true });
  await region.waitFor();
  const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  const table = await region.evaluate(element => {
    const old = element.scrollLeft; element.scrollLeft = element.scrollWidth;
    const result = { width: element.clientWidth, scrollWidth: element.scrollWidth, scrolled: element.scrollLeft, overflowX: getComputedStyle(element).overflowX };
    element.scrollLeft = old; return result;
  });
  layouts.push({ workflow: current, name, layout, table });
  check(name + " 无整页横向溢出", layout.document <= layout.viewport + 1 && layout.body <= layout.viewport + 1, layout);
  check(name + " 表格局部滚动容器", ["auto", "scroll"].includes(table.overflowX), table);
  if (layout.viewport === 390) check(name + " 窄屏可实际横向滚动", table.scrollWidth > table.width && table.scrolled > 0, table);
  await shot(page, name);
}
const statement = actor => call(actor, "/api/credits");
const list = (admin, actor) => call(admin, "/api/admin/refunds?q=" + actor.user.id);
async function lookup(admin, id) { return (await call(admin, "/api/admin/refunds?q=" + id)).refunds.find(row => row.id === id); }
async function fixture(admin, actor) {
  const entry = (await call(admin, "/api/admin/recharges", { accountId: actor.user.id, requestId: randomUUID(), paidRmb: "20.00", receiptReference: "IN-" + randomUUID(), reason: "浏览器隔离原实付" })).entry;
  await call(admin, "/api/admin/users/" + actor.user.id + "/credits", { requestId: randomUUID(), type: "grant", amount: "500", reason: "赠送额度不折现" });
  return entry;
}
const draftKey = (admin, actor) => "manual-refund:" + admin.user.id + ":" + actor.user.id;
const actionKey = (admin, id) => "manual-refund-action:" + admin.user.id + ":" + id;
async function draft(page, key) { return page.evaluate(key => JSON.parse(sessionStorage.getItem(key) || "null"), key); }
async function waitCleared(page, key) { await page.waitForFunction(key => sessionStorage.getItem(key) === null, key); }
async function newRefund(admin, actor, entry, amount, reason) {
  await admin.page.goto(base + "/admin/users/" + actor.user.id + "/credits");
  const form = admin.page.getByRole("region", { name: "发起人工退款", exact: true });
  await form.getByLabel("原充值来源", { exact: true }).selectOption(entry.id);
  await form.getByLabel("退款人民币（元）", { exact: true }).fill(amount);
  await form.getByLabel("业务说明", { exact: true }).fill(reason);
  return form;
}
async function createUI(admin, actor, entry, amount, reason) {
  const form = await newRefund(admin, actor, entry, amount, reason);
  await form.getByRole("button", { name: "锁定积分并创建退款记录", exact: true }).click();
  await form.getByRole("link", { name: "查看本笔退款并登记外部结果" }).waitFor();
  await waitCleared(admin.page, draftKey(admin, actor));
  const row = (await list(admin, actor)).refunds.find(row => row.reason === reason);
  must("真实 UI 发起已持久，未转账且仅锁定", row?.transferStatus === "unverified" && row.accountingStatus === "held", row);
  await form.getByRole("link", { name: "查看本笔退款并登记外部结果" }).click();
  await admin.page.getByRole("form", { name: "处理退款 " + row.id, exact: true }).waitFor();
  return row;
}
async function actionForm(admin, id, action, reason, reference) {
  const form = admin.page.getByRole("form", { name: "处理退款 " + id, exact: true });
  await form.getByLabel("处理方式", { exact: true }).selectOption(action);
  await form.getByLabel("核实依据 / 恢复说明", { exact: true }).fill(reason);
  if (reference) await form.getByLabel("外部交易参考号", { exact: true }).fill(reference);
  await form.getByRole("checkbox").check(); return form;
}
async function finishUI(admin, id, action, reason, reference) {
  const form = await actionForm(admin, id, action, reason, reference);
  await form.getByRole("button", { name: action === "complete" ? "仅重试内部记账" : "登记已核实的外部结果", exact: true }).click();
  const expected = action === "mark-failed" ? "released" : "completed";
  const row = await poll(() => lookup(admin, id), row => row?.accountingStatus === expected, "UI 登记持久");
  await waitCleared(admin.page, actionKey(admin, id));
  await admin.page.getByText(action === "mark-failed" ? "锁定已释放" : "内部扣账完成", { exact: true }).first().waitFor();
  must("真实 UI 登记结果 " + action, row.transferStatus === (action === "mark-failed" ? "failed" : "succeeded"), row);
  return row;
}
async function userEvidence(actor, admin, expectedAvailable, expectedCount, name, held = "0") {
  const value = await statement(actor);
  must(name + " HTTP 独立账单：购买/赠送/预留/退款锁定", value.balance.purchased.available === expectedAvailable && value.balance.purchased.reserved === "0" && value.balance.gift.available === "500" && value.refundHeld === held, value);
  await actor.page.goto(base + "/profile");
  const history = actor.page.getByRole("region", { name: "人工退款记录", exact: true });
  await history.getByRole("button", { name: "刷新退款与余额" }).click();
  await history.getByRole("table").waitFor();
  must(name + " 用户记录总数", (await history.getByRole("caption").innerText()).includes("共 " + expectedCount + " 笔"));
  // 直接核对用户可见的余额区域，避免只依赖后台 HTTP。
  const balances = actor.page.locator('[aria-label="积分余额"]');
  must(name + " 用户可见最终余额", (await balances.innerText()).includes(expectedAvailable) && (await balances.innerText()).includes("500"));
  const rows = (await list(admin, actor)).refunds;
  for (const row of rows) {
    const tr = history.getByRole("row").filter({ hasText: row.reason });
    await tr.getByText("查看退款凭据", { exact: true }).click();
    const text = await tr.innerText();
    check(name + " 完整用户凭据 " + row.id, [row.id, row.rechargeEntryId, row.sourceId, row.reason, row.actorEmail, row.externalReference ?? "待核实", row.transferReason ?? "待核实"].every(item => text.includes(item)), text);
    const status = row.accountingStatus === "completed" ? "内部扣账完成" : row.accountingStatus === "released" ? "锁定已释放" : "积分已锁定";
    check(name + " 用户可见处理状态 " + row.id, text.includes(status), text);
  }
  await visual(actor.page, name, "退款记录，可横向滚动");
}
// route.fetch 先取得真实成功响应，随后才丢弃/替换浏览器收到的响应。
async function intercept(page, path, method, mode, run) {
  let captured, routeError;
  const match = url => url.pathname === path;
  const handler = async route => {
    if (route.request().method() !== method) return route.continue();
    try {
      const operation = route.request().postDataJSON();
      const response = await route.fetch(); const body = await response.json();
      captured = { operation, body, status: response.status(), mode, method, path };
      if (!response.ok() || !body.refund?.id) throw Error("故障注入前真实 HTTP 未成功");
      if (mode === "lost") await route.abort("failed");
      else if (mode === "500") await route.fulfill({ status: 500, json: { error: "隔离：提交已持久但返回 500，结果待核实" } });
      else { const value = structuredClone(body); delete value.refund.sourceId; await route.fulfill({ status: 200, json: value }); }
    } catch (error) { routeError = error; await route.abort("failed").catch(() => {}); }
  };
  await page.route(match, handler);
  try { await run(); await poll(() => captured || routeError, Boolean, "等待响应故障"); }
  finally { await page.unroute(match, handler); }
  if (routeError) throw routeError;
  responses.push({ workflow: current, intercepted: true, ...captured });
  return captured;
}
async function sameRetry(page, path, method, button, original) {
  const received = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method);
  await button.click(); const response = await received;
  must("原操作重试逐字段一致", JSON.stringify(response.request().postDataJSON()) === JSON.stringify(original), response.request().postDataJSON());
  must("原操作重试返回同一退款", response.ok() && !!(await response.json()).refund?.id);
  return (await response.json()).refund;
}

try {
  await mkdir(join(output, "screenshots"), { recursive: true });
  const sourceFiles = ["scripts/verify-v144-manual-refund-browser.mjs", "scripts/verify-v144-manual-refund-browser-scenario.mjs", "src/components/ManualRefundForm.tsx", "src/components/ManualRefundAction.tsx", "src/components/ManualRefundHistory.tsx", "src/lib/manual-refunds.ts"];
  const sources = await Promise.all(sourceFiles.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(resolve(path))).digest("hex") })));
  await writeFile(join(output, "source-snapshot.json"), JSON.stringify({ at: new Date().toISOString(), sources }, null, 2));
  // 显式 executable 优先；已有 Playwright 配置保持原样，再探测 Edge 和本机缓存。
  const candidates = process.env.PLAYWRIGHT_EXECUTABLE_PATH ? [process.env.PLAYWRIGHT_EXECUTABLE_PATH] : [chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"];
  for (const candidate of candidates) { try { await access(candidate); browserExecutable = candidate; break; } catch {} }
  if (!browserExecutable && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = "D:/DevCache/ms-playwright";
    const candidate = chromium.executablePath();
    try { await access(candidate); browserExecutable = candidate; } catch {}
  }
  if (!browserExecutable) throw Error("未找到浏览器，请配置 PLAYWRIGHT_EXECUTABLE_PATH 或 PLAYWRIGHT_BROWSERS_PATH");
  browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
  for (const width of [1440, 390]) {
    const viewport = { width, height: width === 1440 ? 1000 : 844 };
    const admin = await client(process.env.V144_ADMIN_EMAIL, viewport);
    const second = await client(process.env.V144_SECOND_ADMIN_EMAIL, viewport);
    await section(width + "-lifecycle", async () => {
      const actor = await client("refund-life-" + randomUUID() + "@test.local", viewport), entry = await fixture(admin, actor);
      const row = await createUI(admin, actor, entry, "2.00", "浏览器正常退款 " + width);
      await visual(admin.page, width + "-admin-held", "后台退款记录，可横向滚动");
      await userEvidence(actor, admin, "18000", 1, width + "-user-held", "2000");
      await finishUI(admin, row.id, "confirm-transfer", "已独立核实外部成功", "OUT-" + randomUUID());
      await visual(admin.page, width + "-admin-completed", "后台退款记录，可横向滚动");
      const released = await createUI(admin, actor, entry, "1.00", "浏览器未转账释放 " + width);
      await finishUI(admin, released.id, "mark-failed", "已核实未发生外部转账");
      const legacy = await createUI(admin, actor, entry, "1.00", "浏览器旧登记恢复 " + width);
      const key = actionKey(admin, legacy.id), old = { action: "mark-failed", reason: "旧客户端未知未转账登记" };
      await admin.page.evaluate(({ key, old }) => sessionStorage.setItem(key, JSON.stringify(old)), { key, old });
      await lifecycle("refund-write-fault");
      try {
        const result = await call(second, "/api/admin/refunds/" + legacy.id, { action: "confirm-transfer", reason: "另一管理员已核实外部成功", externalReference: "OUT-" + randomUUID() }, 200, "PATCH");
        must("另管理员真实确认成功，内部故障保持锁定", result.refund.transferStatus === "succeeded" && result.refund.accountingStatus === "held" && !!result.warning, result);
      } finally { await lifecycle("refund-clear-fault"); }
      await admin.page.reload();
      const conflict = admin.page.getByRole("region", { name: "处理退款 " + legacy.id, exact: true });
      await conflict.getByRole("button", { name: "核对最新状态并转入内部记账", exact: true }).waitFor();
      must("旧 mark-failed 原草稿保留并显式展示冲突", JSON.stringify(await draft(admin.page, key)) === JSON.stringify(old) && (await conflict.innerText()).includes("原待确认登记与最新记录冲突"));
      await visual(admin.page, width + "-legacy-conflict", "后台退款记录，可横向滚动");
      await conflict.getByRole("button", { name: "核对最新状态并转入内部记账", exact: true }).click();
      await waitCleared(admin.page, key);
      const form = admin.page.getByRole("form", { name: "处理退款 " + legacy.id, exact: true });
      must("显式核对后只允许 complete", await form.getByLabel("处理方式", { exact: true }).inputValue() === "complete" && await form.getByRole("button", { name: "仅重试内部记账", exact: true }).isDisabled());
      await finishUI(admin, legacy.id, "complete", "核对最新事实后仅完成内部记账");
      const value = await statement(actor);
      check("恢复只扣一次且外部成功审计属于另一管理员", value.entries.filter(row => row.businessType === "manual_refund" && row.context?.refundId === legacy.id).length === 1 && value.entries.some(row => row.businessType === "manual_refund_transfer" && row.context?.refundId === legacy.id && row.actorId === second.user.id));
      await userEvidence(actor, admin, "17000", 3, width + "-user-final");
    });
    await section(width + "-unknown-responses", async () => {
      const actor = await client("refund-unknown-" + randomUUID() + "@test.local", viewport), entry = await fixture(admin, actor);
      let index = 0;
      for (const mode of ["lost", "500", "missing-source"]) {
        index++;
        const form = await newRefund(admin, actor, entry, "1.00", "浏览器未知响应 " + width + " " + mode);
        const key = draftKey(admin, actor);
        const captured = await intercept(admin.page, "/api/admin/refunds", "POST", mode, () => form.getByRole("button", { name: "锁定积分并创建退款记录", exact: true }).click());
        await form.getByRole("alert").waitFor();
        const saved = await draft(admin.page, key), row = await lookup(admin, captured.body.refund.id);
        must(mode + " 发起已真实持久且原身份/来源/金额/说明保留", row?.accountingStatus === "held" && JSON.stringify(saved) === JSON.stringify(captured.operation), { row, saved });
        check(mode + " 发起输入锁定", await form.getByLabel("退款人民币（元）", { exact: true }).isDisabled() && await form.getByLabel("原充值来源", { exact: true }).isDisabled() && await form.getByLabel("业务说明", { exact: true }).isDisabled());
        await admin.page.reload();
        must(mode + " 发起刷新仍保留原操作", JSON.stringify(await draft(admin.page, key)) === JSON.stringify(saved));
        await visual(admin.page, width + "-" + mode + "-create-pending", "积分流水，可横向滚动");
        const retried = await sameRetry(admin.page, "/api/admin/refunds", "POST", admin.page.getByRole("button", { name: "核对并重试原退款发起", exact: true }), saved);
        await waitCleared(admin.page, key);
        must(mode + " 发起重试同一退款且无新增", retried.id === row.id && (await list(admin, actor)).total === index);
        await admin.page.getByRole("link", { name: "查看本笔退款并登记外部结果" }).click();
        const action = await actionForm(admin, row.id, "confirm-transfer", "未知响应外部成功已核实 " + mode, "OUT-" + randomUUID());
        const path = "/api/admin/refunds/" + row.id, akey = actionKey(admin, row.id);
        const confirmed = await intercept(admin.page, path, "PATCH", mode, () => action.getByRole("button", { name: "登记已核实的外部结果", exact: true }).click());
        await action.getByRole("alert").waitFor();
        const original = await draft(admin.page, akey), persisted = await lookup(admin, row.id);
        must(mode + " 登记已持久但保留原操作", persisted?.transferStatus === "succeeded" && persisted.accountingStatus === "completed" && JSON.stringify(original) === JSON.stringify(confirmed.operation));
        check(mode + " 登记输入锁定", await action.getByLabel("核实依据 / 恢复说明", { exact: true }).isDisabled());
        await admin.page.reload();
        must(mode + " 登记刷新保留原操作", JSON.stringify(await draft(admin.page, akey)) === JSON.stringify(original));
        await visual(admin.page, width + "-" + mode + "-action-pending", "后台退款记录，可横向滚动");
        const result = await sameRetry(admin.page, path, "PATCH", admin.page.getByRole("button", { name: "核对并重试原登记", exact: true }), original);
        await waitCleared(admin.page, akey);
        const value = await statement(actor);
        must(mode + " 登记重放返回原记录且只扣一次", result.id === row.id && result.accountingStatus === "completed" && value.entries.filter(item => item.businessType === "manual_refund" && item.context?.refundId === row.id).length === 1);
        await userEvidence(actor, admin, String(20000 - 1000 * index), index, width + "-" + mode + "-user");
      }
    });
  }
} catch (error) { if (!error.counted) check("场景初始化/执行：" + error.message, false); }
finally {
  check("所有浏览器页面无 pageerror", pageerrors.length === 0, pageerrors);
  for (const context of contexts) try { await context.close(); } catch (error) { check("浏览器上下文清理：" + error.message, false); }
  if (browser) try { await browser.close(); } catch (error) { check("浏览器清理：" + error.message, false); }
  check("完整执行两个宽度的四个工作流", workflows.length === 4, workflows);
  await progress();
  await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, workflows, assertions, responses, screenshots, layouts, pageerrors, browserExecutable, aiMode: "replay", realFunds: 0, realModelCalls: 0 }, null, 2));
}
console.log("结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);
