// #13：跨票业务链只经应用 HTTP 与浏览器验证；邮件和模型只在外部边界替身控制。
import { request, chromium } from "playwright-core";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requestRegistrationCode, latestEmailCode } from "./verify-email-fixture.mjs";
let base = process.env.BASE_URL, pass = 0, fail = 0, browser;
const clients = [], assertions = [], workflows = [], screenshots = [], responses = [], output = process.env.V141_REPLAY_OUTPUT_DIR;
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
  workflows.push("gift-first-generation-retry-naming-restart-password-reset");

  const refundInput = { accountId: actor.user.id, rechargeEntryId: entry.id, requestId: randomUUID(), refundRmb: "0.01", reason: "隔离退还尚未消费的原充值" };
  const refund = (await api(admin, "/api/admin/refunds", refundInput)).refund;
  const held = await api(restored, "/api/credits");
  check("原购买10全部退款锁定，赠送消费不受影响", held.balance.purchased.available === "0" && held.refundHeld === "10" && held.balance.gift.available === after.balance.gift.available);
  await api(profileActor, "/api/admin/refunds", refundInput, 403);
  await api(profileActor, messagePath, undefined, 404);
  const transfer = { action: "confirm-transfer", externalReference: "isolated-out-" + randomUUID(), reason: "隔离模拟外部成功，无真实转账" };
  const completed = await api(admin, "/api/admin/refunds/" + refund.id, transfer, 200, "PATCH");
  check("退款最终已完成且保留原充值来源", completed.refund.accountingStatus === "completed" && completed.refund.rechargeEntryId === entry.id);
  await api(admin, "/api/admin/refunds", refundInput);
  await api(admin, "/api/admin/refunds/" + refund.id, transfer, 200, "PATCH");
  const final = await api(restored, "/api/credits");
  check("最终赠送1995.968或1997.984，购买0，退款锁0", final.balance.gift.available === after.balance.gift.available && final.balance.purchased.available === "0" && final.refundHeld === "0" && final.balance.gift.reserved === "0");
  check("跨票审计仅一次充值/消费/退款", ["manual_recharge", "model_settle", "manual_refund"].every(type => final.entries.filter(row => row.businessType === type).length === 1));
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
      if (label === "profile") check("改密与退款后页面含当前账号", (await page.locator("body").innerText()).includes(actor.user.id));
      const filename = "release-" + width + "-" + label + ".png";
      await page.screenshot({ path: join(output, filename), fullPage: true }); screenshots.push(filename);
    }
    check(width + "无页面运行异常", errors.length === 0); await context.close();
  }
  workflows.push("desktop-and-narrow-profile-workspace");
} catch (error) { if (!assertions.at(-1) || assertions.at(-1).okay) { fail++; assertions.push({ name: error.message, okay: false }); } console.error("❌ " + error.message); }
finally {
  await browser?.close(); for (const http of clients) await http.dispose();
  await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, workflows, assertions, responses, screenshots, aiMode: "replay", realLlmCostCny: "0", realFundsCny: "0" }, null, 2));
}
console.log("组合结果：" + pass + "通过，" + fail + "失败"); process.exitCode = fail > 0 ? 1 : 0;
