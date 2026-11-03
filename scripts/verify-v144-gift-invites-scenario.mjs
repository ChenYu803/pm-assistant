// 从注册、个人中心和后台 HTTP / 浏览器入口验证赠送邀请码。
import { chromium, request } from "playwright-core";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requestRegistrationCode } from "./verify-email-fixture.mjs";

const base = process.env.BASE_URL, output = process.env.V141_REPLAY_OUTPUT_DIR;
let pass = 0, fail = 0, browser;
const clients = [], workflows = [], assertions = [];
function check(name, okay) { assertions.push({ name, passed: !!okay }); console.log((okay ? "✅ " : "❌ ") + name); if (okay) pass++; else fail++; return !!okay; }
async function client() { const value = await request.newContext({ baseURL: base, timeout: 120_000 }); clients.push(value); return value; }
async function login(http, email) {
  const csrfToken = (await (await http.get(base + "/api/auth/csrf")).json()).csrfToken;
  await http.post(base + "/api/auth/callback/credentials", { form: { email, password: "gift-test-12345", csrfToken, callbackUrl: base + "/profile" }, headers: { "X-Auth-Return-Redirect": "1" } });
  return (await (await http.get(base + "/api/auth/session")).json())?.user;
}
async function register(http, label, giftInvite, emailOverride) {
  const email = emailOverride || `gift-${randomUUID()}-${label}@test.local`;
  const data = { email, password: "gift-test-12345", code: await requestRegistrationCode(http, email) };
  if (giftInvite) data.giftInvite = giftInvite;
  const response = await http.post("/api/auth/register", { data });
  return { response, email, body: await response.json() };
}
async function json(http, path) { const response = await http.get(base + path); return { response, body: await response.json() }; }
try {
  const admin = await client(), anonymous = await client();
  const adminEmail = process.env.V144_ADMIN_EMAIL;
  const adminAccount = await register(admin, "admin", undefined, adminEmail);
  check("管理员测试账号可注册且不自动获赠", adminAccount.response.status() === 201 && !adminAccount.body.giftInvite.redeemed);
  await login(admin, adminEmail);
  check("游客不能查询或初始化邀请码", (await anonymous.get(base + "/api/admin/gift-invites")).status() === 401 && (await anonymous.post(base + "/api/admin/gift-invites", { data: { reason: "test" } })).status() === 401);
  const seededResponse = await admin.post(base + "/api/admin/gift-invites", { data: { reason: "v1.44 隔离验收首批" } });
  const seeded = await seededResponse.json();
  check("管理员一次初始化恰好 100 个不同码", seededResponse.status() === 201 && seeded.codes?.length === 100 && new Set(seeded.codes ?? []).size === 100);
  if (seededResponse.status() !== 201) console.log("初始化反馈：" + JSON.stringify({ status: seededResponse.status(), error: seeded.error }));
  if (!Array.isArray(seeded.codes)) throw new Error("首批邀请码未能创建。");
  const repeatSeed = await admin.post(base + "/api/admin/gift-invites", { data: { reason: "重试" } });
  let listed = await json(admin, "/api/admin/gift-invites");
  check("初始化重试不增发且列表不暴露明文码", repeatSeed.status() === 409 && listed.body.codes.length === 100 && !JSON.stringify(listed.body).includes(seeded.codes[0]));
  const codes = seeded.codes;
  workflows.push("admin-one-time-batch-and-audit");

  const invalid = await register(await client(), "invalid", "NOT-A-REAL-CODE");
  check("无效码不回滚已验证注册且明确未获赠送", invalid.response.status() === 201 && !invalid.body.giftInvite.redeemed && /无效|未获得|未领取/.test(invalid.body.giftInvite.error));
  const registration = await register(await client(), "register", codes[0]);
  check("注册时有效码独立到账 2000 积分", registration.response.status() === 201 && registration.body.giftInvite.redeemed && registration.body.giftInvite.credits === "2000");
  const registered = await client(); await login(registered, registration.email);
  let statement = await json(registered, "/api/credits");
  check("注册兑换流水与余额一致", statement.body.balance.gift.available === "2000" && statement.body.total === 1 && statement.body.entries[0].businessType === "invite_redemption");
  const profile = (await registered.get(base + "/profile")).text();
  check("刷新个人中心隐藏已兑换入口", !(await profile).includes('id="profile-gift-invite"') && /已成功领取赠送积分/.test(await profile));
  workflows.push("registration-success-and-invalid-code");

  const user = await client(), userReg = await register(user, "profile"); await login(user, userReg.email);
  const requestId = "gift-test-" + randomUUID();
  const redeemed = await user.post(base + "/api/gift-invites", { data: { code: codes[1], requestId } });
  const redeemedBody = await redeemed.json();
  const retry = await user.post(base + "/api/gift-invites", { data: { code: codes[1], requestId } });
  const retryBody = await retry.json();
  const another = await user.post(base + "/api/gift-invites", { data: { code: codes[2], requestId: "gift-test-" + randomUUID() } });
  statement = await json(user, "/api/credits");
  check("重复提交返回原成功结果且只入账一次", redeemed.status() === 200 && redeemedBody.credits === "2000" && retry.status() === 200 && retryBody.replayed && retryBody.balance.gift.available === "2000" && statement.body.total === 1);
  check("同账号第二码拒绝且不再增加余额", another.status() === 409 && statement.body.balance.gift.available === "2000");
  browser = await chromium.launch({ headless: true });
  const userPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await userPage.context().addCookies((await user.storageState()).cookies);
  await userPage.goto(base + "/profile");
  await userPage.getByText("已成功领取赠送积分，邀请码兑换入口已关闭。", { exact: true }).waitFor();
  check("窄屏个人中心刷新状态且页面无横向溢出", await userPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await userPage.screenshot({ path: join(output, "gift-profile-mobile.png"), fullPage: true });
  workflows.push("profile-redemption-idempotency-and-refresh");

  const voidId = listed.body.codes.find(row => row.status === "available")?.id;
  const voided = await admin.delete(base + "/api/admin/gift-invites/" + voidId, { data: { reason: "验证作废路径" } });
  const voidRetry = await admin.delete(base + "/api/admin/gift-invites/" + voidId, { data: { reason: "重复作废" } });
  const records = await json(admin, "/api/admin/gift-invites");
  const voidCode = await user.post(base + "/api/gift-invites", { data: { code: codes[3], requestId: "gift-test-" + randomUUID() } });
  check("管理员作废后领取和审计记录可查", voided.ok() && voidRetry.status() === 409 && records.body.codes.find(row => row.id === voidId).status === "void" && records.body.codes.some(row => row.status === "redeemed" && row.redeemedEmail === registration.email) && records.body.actions.some(row => row.action === "void" && row.reason === "验证作废路径"));
  check("作废码兑换被拒绝且不改变既有领取", voidCode.status() === 409 && (await json(user, "/api/gift-invites")).body.redeemed);
  const adminPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await adminPage.context().addCookies((await admin.storageState()).cookies);
  await adminPage.goto(base + "/admin/gift-invites");
  await adminPage.getByRole("heading", { name: "赠送邀请码" }).waitFor();
  check("后台桌面布局无横向溢出", await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await adminPage.screenshot({ path: join(output, "gift-admin-desktop.png"), fullPage: true });
  workflows.push("admin-void-audit-and-permissions");

  const first = await client(), second = await client();
  const firstReg = await register(first, "race-a"), secondReg = await register(second, "race-b");
  await login(first, firstReg.email); await login(second, secondReg.email);
  const sameCode = await Promise.all([first.post(base + "/api/gift-invites", { data: { code: codes[4], requestId: "gift-test-" + randomUUID() } }), second.post(base + "/api/gift-invites", { data: { code: codes[4], requestId: "gift-test-" + randomUUID() } })]);
  check("不同账号并发抢同码仅一人成功", sameCode.filter(response => response.status() === 200).length === 1 && sameCode.filter(response => response.status() === 409).length === 1);
  const multiUser = await client(), multiRegistration = await register(multiUser, "race-multi");
  await login(multiUser, multiRegistration.email);
  const multi = await Promise.all([codes[5], codes[6]].map(code => multiUser.post(base + "/api/gift-invites", { data: { code, requestId: "gift-test-" + randomUUID() } })));
  const firstStatement = await json(multiUser, "/api/credits");
  check("同账号并发提交多码仅一笔赠送", multi.filter(response => response.status() === 200).length === 1 && multi.filter(response => response.status() === 409).length === 1 && firstStatement.body.balance.gift.available === "2000" && firstStatement.body.total === 1);
  workflows.push("concurrent-code-and-account-claim");
  await userPage.close(); await adminPage.close(); await browser.close(); browser = undefined;
} catch (error) {
  check("场景完整执行：" + String(error?.message ?? error).split("\n")[0], false);
} finally {
  if (browser) await browser.close();
  for (const http of clients) await http.dispose();
  await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, workflows, assertions, aiMode: "replay" }, null, 2));
}
console.log("结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);
