// 正式 HTTP / 浏览器边界；独立已知账单，测试专用 IPC 只构造隔离初态与重启应用。
import { chromium, request } from "playwright-core";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requestRegistrationCode } from "./verify-email-fixture.mjs";
let base = process.env.BASE_URL;
const output = process.env.V141_REPLAY_OUTPUT_DIR;
let pass = 0, fail = 0, browser;
const clients = [], workflows = [], assertions = [], comparisonFailures = [];
// 数据库 JSON 的键顺序不属于账本契约；完整比较字段、值和数组顺序。
function same(left, right) { const okay = isDeepStrictEqual(left, right); if (!okay) comparisonFailures.push({ left, right }); return okay; }
function check(name, okay) { assertions.push({ name, okay: !!okay }); console.log((okay ? "✅ " : "❌ ") + name); if (okay) pass++; else fail++; }
async function client() { const value = await request.newContext({ baseURL: base, timeout: 120_000 }); clients.push(value); return value; }
async function login(http, email, password = "credits-test-12345") {
  const csrfToken = (await (await http.get(base + "/api/auth/csrf")).json()).csrfToken;
  await http.post(base + "/api/auth/callback/credentials", { form: { email, password, csrfToken, callbackUrl: base + "/projects" }, headers: { "X-Auth-Return-Redirect": "1" } });
  return (await (await http.get(base + "/api/auth/session")).json())?.user;
}
async function register(http, email) {
  const response = await http.post("/api/auth/register", { data: { email, password: "credits-test-12345", code: await requestRegistrationCode(http, email) } });
  if (response.status() !== 201) throw Error("隔离注册失败 " + response.status());
  return login(http, email);
}
async function json(http, path) { const response = await http.get(base + path); if (!response.ok()) throw Error("HTTP " + response.status() + " " + path); return response.json(); }
const operation = (amount, type = "grant", reason = "测试赠送") => ({ requestId: randomUUID(), type, amount, reason });
async function post(http, path, value, status = 200) {
  const response = await http.post(base + path, { data: value });
  check("操作返回 " + status + "：" + value.type + " " + value.amount, response.status() === status);
  if (response.status() !== status) throw Error("预期 " + status + "，实际 " + response.status());
  return response.json();
}
function lifecycle(type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { process.off("message", listener); reject(Error("隔离生命周期超时")); }, 120_000);
    function listener(value) { if (value?.type !== type) return; clearTimeout(timer); process.off("message", listener); if (value.error) reject(Error(value.error)); else resolve(value); }
    process.on("message", listener); process.send({ type });
  });
}
try {
  const anonymous = await client(), admin = await client(), target = await client(), other = await client(), legacy = await client();
  const adminUser = await register(admin, process.env.V144_ADMIN_EMAIL);
  const user = await register(target, "credits-target-" + randomUUID() + "@test.local");
  const otherUser = await register(other, "credits-other-" + randomUUID() + "@test.local");
  const legacyUser = await login(legacy, process.env.V144_LEGACY_EMAIL, process.env.V144_LEGACY_PASSWORD);
  const endpoint = "/api/admin/users/" + user.id + "/credits";
  const selfEndpoint = "/api/admin/users/" + adminUser.id + "/credits";
  const zero = await json(target, "/api/credits");
  check("新账号稳定账号 ID 与赠送/购买可用、预留均为零", zero.accountId === user.id && zero.balance.gift.available === "0" && zero.balance.gift.reserved === "0" && zero.balance.purchased.available === "0" && zero.balance.purchased.reserved === "0" && zero.entries.length === 0);
  const old = await json(legacy, "/api/credits");
  check("旧账号无虚构赠送或购买", old.accountId === legacyUser.id && old.balance.gift.available === "0" && old.balance.purchased.available === "0" && old.total === 0);
  check("旧账号与升级前项目资料保留", (await json(legacy, "/api/projects")).some(item => item.id === process.env.V144_LEGACY_PROJECT_ID) && (await json(legacy, "/api/projects/" + process.env.V144_LEGACY_PROJECT_ID + "/files")).some(item => item.id === process.env.V144_LEGACY_FILE_ID) && (await json(legacy, "/api/projects/" + process.env.V144_LEGACY_PROJECT_ID + "/files/" + process.env.V144_LEGACY_FILE_ID)).content === "升级前原始资料，不应被邮箱验证升级覆盖。");
  check("游客不能读账", (await anonymous.get(base + "/api/credits")).status() === 401);
  check("游客不能查询管理账本", (await anonymous.get(base + endpoint)).status() === 401);
  check("游客不能写入管理账本", (await anonymous.post(base + endpoint, { data: operation("1") })).status() === 401);
  check("普通用户不能查询其他账号管理账本", (await target.get(base + endpoint)).status() === 403);
  check("普通用户不能自授积分", (await target.post(base + endpoint, { data: operation("9") })).status() === 403);
  check("普通用户不能给其他账号加分", (await other.post(base + endpoint, { data: operation("9") })).status() === 403);
  check("个人查询不能接受跨账号参数", (await target.get(base + "/api/credits?userId=" + otherUser.id)).status() === 400);
  check("个人积分没有写入方法", (await target.post(base + "/api/credits", { data: operation("9") })).status() === 405);
  check("非法页码被拒绝", (await target.get(base + "/api/credits?page=0")).status() === 400);
  check("管理查询不存在账号返回404", (await admin.get(base + "/api/admin/users/" + randomUUID() + "/credits")).status() === 404);
  const first = operation("100.12345678", "grant", "测试赠送 <script>window.creditXss=1</script>");
  const granted = await post(admin, endpoint, first);
  const compensated = await post(admin, endpoint, operation("0.2", "compensation", "故障补偿"));
  const corrected = await post(admin, endpoint, operation("-0.1", "correction", "纠正多发额度"));
  let statement = await json(target, "/api/credits");
  check("独立小数账单100.12345678+0.2-0.1=100.22345678", statement.balance.gift.available === "100.22345678" && statement.balance.purchased.available === "0");
  check("赠送、补偿、纠正分别留痕且来源不冒充购买", [granted.entry.businessType, compensated.entry.businessType, corrected.entry.businessType].join() === "admin_grant,admin_compensation,admin_correction" && statement.entries.every(item => item.sourceKind === "gift"));
  check("记录操作者时间原因与精确前后余额", corrected.entry.actorId === adminUser.id && corrected.entry.accountId === user.id && corrected.entry.reason === "纠正多发额度" && Number.isFinite(Date.parse(corrected.entry.createdAt)) && corrected.entry.before.gift.available === "100.32345678" && corrected.entry.after.gift.available === "100.22345678");
  check("双方可核对同一流水与余额", same(await json(admin, endpoint), statement));
  const duplicate = operation("0.00000001", "grant", "并发重复请求");
  const responses = await Promise.all(Array.from({ length: 12 }, () => admin.post(base + endpoint, { data: duplicate })));
  const results = await Promise.all(responses.map(response => response.json()));
  check("12个同操作并发仅一份有效结果", responses.every(response => response.status() === 200) && new Set(results.map(result => result.entry.id)).size === 1 && results.filter(result => !result.replayed).length === 1);
  statement = await json(target, "/api/credits");
  check("最小小数没有向上取整且总账只新增一笔", statement.balance.gift.available === "100.22345679" && statement.total === 4);
  const retry = await post(admin, endpoint, first);
  check("响应后重发保留原始ID、时间和前后余额", retry.replayed && same(retry.entry, granted.entry));
  await post(admin, endpoint, { ...first, amount: "1" }, 409);
  await post(admin, endpoint, { ...first, reason: "修改原因" }, 409);
  await post(admin, selfEndpoint, first, 409);
  const race = await Promise.all([admin.post(base + endpoint, { data: operation("-70", "correction", "并发扣减一") }), admin.post(base + endpoint, { data: operation("-70", "correction", "并发扣减二") })]);
  check("并发不同扣减不会透支余额", race.map(item => item.status()).sort().join() === "200,409");
  check("并发扣减后独立账单余额正确", (await json(target, "/api/credits")).balance.gift.available === "30.22345679");
  const failed = operation("-1000", "correction", "余额不足可重试");
  await post(admin, endpoint, failed, 409);
  await post(admin, endpoint, { ...failed, amount: "-0.01" });
  check("失败事务不占用幂等标识，可修正后重试", (await json(target, "/api/credits")).balance.gift.available === "30.21345679");
  for (const [name, value] of [
    ["无原因", { ...operation("1"), reason: " " }], ["原因过长", { ...operation("1"), reason: "原".repeat(501) }],
    ["浮点数字", { ...operation("1"), amount: 0.1 }], ["超精度", operation("0.000000001")], ["科学记数", operation("1e3")],
    ["零调整", operation("0")], ["负赠送", operation("-1")], ["超上限", operation("1000000000000")],
    ["伪购买来源", { ...operation("1"), sourceKind: "purchased" }], ["缺操作ID", { ...operation("1"), requestId: "" }],
  ]) { const response = await admin.post(base + endpoint, { data: value }); check(name + "被拒绝且不产生流水", response.status() === 400); }
  check("跨站管理写入被拒绝", (await admin.post(base + endpoint, { data: operation("1"), headers: { Origin: "https://untrusted.example" } })).status() === 403);
  check("超长正文在读取阶段拒绝", (await admin.post(base + endpoint, { data: "x".repeat(8193), headers: { "Content-Type": "application/json" } })).status() === 413);
  check("无效JSON被拒绝", (await admin.post(base + endpoint, { data: "{", headers: { "Content-Type": "application/json" } })).status() === 400);
  for (let index = 0; index < 23; index++) await post(admin, endpoint, operation("0.01", "grant", "分页样本 " + (index + 1)));
  const page1 = await json(target, "/api/credits"), page2 = await json(target, "/api/credits?page=2");
  check("流水真实分页、无重复且余额独立于页码", page1.total === 29 && page1.entries.length === 20 && page2.entries.length === 9 && new Set([...page1.entries, ...page2.entries].map(item => item.id)).size === 29 && page1.balance.gift.available === "30.44345679" && same(page1.balance, page2.balance));
  check("非法操作不污染流水与原始赠送记录", same(page2.entries.find(item => item.id === granted.entry.id), granted.entry));
  check("账号之间账本隔离", (await json(other, "/api/credits")).total === 0 && (await json(other, "/api/credits")).balance.gift.available === "0");
  const adminList = await json(admin, "/api/admin/users?q=" + user.id);
  check("后台账号列表显示持久余额", adminList.users[0].giftAvailable === "30.44345679" && adminList.users[0].purchasedAvailable === "0");
  workflows.push("zero-upgrade-permissions-fractions-idempotency-concurrency-pagination");

  await post(admin, selfEndpoint, operation("0.1", "grant", "自测赠送一"));
  await post(admin, selfEndpoint, operation("0.2", "grant", "自测赠送二"));
  const split = await post(admin, selfEndpoint, operation("-0.25", "correction", "跨赠送来源纠正"));
  check("跨来源扣减保持精确分摊", split.entry.after.gift.available === "0.05" && split.entry.allocations.length === 2 && split.entry.allocations[0].amount === "-0.1" && split.entry.allocations[1].amount === "-0.15");
  await post(admin, selfEndpoint, operation("-0.05", "correction", "自测归零"));
  check("管理员可给自己赠送且管理操作本身不扣积分", (await json(admin, "/api/credits")).balance.gift.available === "0" && (await json(admin, "/api/credits")).total === 4);
  workflows.push("self-grants-and-source-allocation");

  const fixture = await lifecycle("credit-protection-fixture");
  const protectedEndpoint = "/api/admin/users/" + legacyUser.id + "/credits";
  const protectedBefore = await json(legacy, "/api/credits");
  check("已知历史样本分别读取购买与赠送可用和预留", protectedBefore.balance.gift.available === "3.25" && protectedBefore.balance.gift.reserved === "6.75" && protectedBefore.balance.purchased.available === "70.125" && protectedBefore.balance.purchased.reserved === "30");
  await post(admin, protectedEndpoint, operation("-3.25000001", "correction", "不得动用已保护额度"), 409);
  await post(admin, protectedEndpoint, operation("-3.25", "correction", "只纠正可用赠送"));
  const protectedAfter = await json(legacy, "/api/credits");
  check("负向纠正只扣可用赠送，保留预留及购买来源", protectedAfter.balance.gift.available === "0" && protectedAfter.balance.gift.reserved === "6.75" && protectedAfter.balance.purchased.available === "70.125" && protectedAfter.balance.purchased.reserved === "30");
  check("原实付与来源审计不被改写", fixture.fixture.entryIds.every(id => same(protectedAfter.entries.find(item => item.id === id), protectedBefore.entries.find(item => item.id === id))) && protectedAfter.entries.find(item => item.sourceKind === "purchased").context.originalPaidRmb === "0.100125");
  const deleted = await legacy.delete(base + "/api/projects/" + process.env.V144_LEGACY_PROJECT_ID);
  check("删除项目成功且资金记录保留必要快照", deleted.ok() && (await json(legacy, "/api/credits")).entries.some(item => item.context?.projectId === process.env.V144_LEGACY_PROJECT_ID && item.context.projectName === "升级前项目"));
  workflows.push("protected-balances-purchase-basis-and-project-deletion");

  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ storageState: await admin.storageState(), viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = []; page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(base + "/admin/users/" + user.id + "/credits", { timeout: 120_000 });
  await page.getByLabel("变动积分", { exact: true }).fill("0.125");
  await page.getByLabel("操作原因", { exact: true }).fill("浏览器闭环赠送");
  await page.getByRole("button", { name: "记录积分变动", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "积分已记录" }).waitFor();
  check("后台表单赠送后即时读取同一账本", (await json(target, "/api/credits")).balance.gift.available === "30.56845679");
  let lostId;
  await page.route("**/api/admin/users/" + user.id + "/credits", async route => {
    if (route.request().method() !== "POST") return route.continue();
    lostId = route.request().postDataJSON().requestId;
    const response = await route.fetch();
    if (!response.ok()) throw Error("响应丢失样本未成功入账");
    await route.abort("failed");
  }, { times: 1 });
  await page.getByLabel("变动积分", { exact: true }).fill("0.5");
  await page.getByLabel("操作原因", { exact: true }).fill("模拟已提交但响应丢失");
  await page.getByRole("button", { name: "记录积分变动", exact: true }).click();
  await page.getByRole("alert").waitFor();
  let lostOperationRecorded = false;
  for (let attempt = 0; attempt < 10 && !lostOperationRecorded; attempt++) {
    lostOperationRecorded = (await json(target, "/api/credits")).entries.some(item => item.requestId === lostId);
    if (!lostOperationRecorded) await new Promise(resolve => setTimeout(resolve, 100));
  }
  check("响应丢失时服务端确已记录", lostOperationRecorded);
  await page.reload({ timeout: 120_000 });
  await page.getByRole("button", { name: "重试同一操作", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已确认原操作" }).waitFor();
  statement = await json(target, "/api/credits");
  check("响应丢失且页面刷新后重试仍只到账一份", statement.balance.gift.available === "31.06845679" && statement.total === 31 && statement.entries.filter(item => item.requestId === lostId).length === 1);
  await page.screenshot({ path: join(output, "credits-admin-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  check("后台窄屏无整页横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(output, "credits-admin-mobile.png"), fullPage: true });
  const userContext = await browser.newContext({ storageState: await target.storageState(), viewport: { width: 1440, height: 1000 } });
  const userPage = await userContext.newPage(); userPage.on("pageerror", error => pageErrors.push(error.message));
  await userPage.goto(base + "/profile", { timeout: 120_000 });
  check("个人主页展示账号ID与准确小数余额", (await userPage.locator("body").innerText()).includes(user.id) && await userPage.getByText("31.06845679", { exact: true }).count() > 0);
  check("个人主页不暴露管理调整表单", await userPage.getByRole("form", { name: "管理员积分调整" }).count() === 0);
  await userPage.getByRole("button", { name: "下一页", exact: true }).click();
  await userPage.getByText("第 2 / 2 页", { exact: true }).waitFor();
  check("浏览器分页展示旧赠送且原因按文本转义", await userPage.getByText(first.reason, { exact: true }).count() === 1 && !(await userPage.evaluate(() => window.creditXss)));
  await userPage.screenshot({ path: join(output, "credits-profile-desktop.png"), fullPage: true });
  await userPage.setViewportSize({ width: 390, height: 844 });
  check("个人主页窄屏无整体溢出", await userPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const region = userPage.getByRole("region", { name: "积分流水，可横向滚动" }); await region.focus();
  check("窄屏流水区域支持键盘独立横向滚动", await region.evaluate(element => document.activeElement === element && element.scrollWidth > element.clientWidth));
  await userPage.screenshot({ path: join(output, "credits-profile-mobile.png"), fullPage: true });
  check("页面无运行时错误", pageErrors.length === 0);
  await context.close(); await userContext.close(); await browser.close(); browser = undefined;
  workflows.push("browser-grant-response-loss-refresh-pagination-and-responsive");

  const beforeRestart = await json(target, "/api/credits");
  const protectedRestart = await json(legacy, "/api/credits");
  const restarted = await lifecycle("restart-credit-app"); base = restarted.base;
  check("应用实际进程重启后账本与审计完全一致", same(await json(target, "/api/credits"), beforeRestart) && same(await json(legacy, "/api/credits"), protectedRestart));
  const replayAfterRestart = await post(admin, endpoint, first);
  check("进程重启后原请求仍可幂等重放", replayAfterRestart.replayed && same(replayAfterRestart.entry, granted.entry) && (await json(target, "/api/credits")).total === beforeRestart.total);
  workflows.push("process-restart-and-persistent-idempotency");

  // 重启对照完成后只停用独立 other 账号，保留主账号和历史账号状态。
  const otherEndpoint = "/api/admin/users/" + otherUser.id + "/credits";
  const otherBeforeDisable = await json(admin, otherEndpoint);
  const disabled = await admin.post(base + "/api/admin/users/" + otherUser.id + "/disable", { data: { reason: "积分权限专项停用样本" } });
  check("正式接口成功停用独立测试账号", disabled.ok());
  check("停用账号既有登录不能继续读取个人积分", (await other.get(base + "/api/credits")).status() === 403);
  check("管理员仍可查询停用账号完整账本审计", same(await json(admin, otherEndpoint), otherBeforeDisable));
} catch (error) { check("场景完整执行：" + error.message, false); }
finally {
  if (browser) await browser.close();
  for (const http of clients) await http.dispose();
  await writeFile(join(output, "comparison-failures.json"), JSON.stringify(comparisonFailures, null, 2));
  await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, workflows, assertions, aiMode: "replay" }, null, 2));
}
console.log("结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);
