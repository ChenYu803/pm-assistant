// 验证公共 HTTP / 页面边界；只在邮件与模型供应商边界使用替身。
import { chromium, request } from "playwright-core";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { latestEmailCode, requestRegistrationCode } from "./verify-email-fixture.mjs";
const base = process.env.BASE_URL, output = process.env.V141_REPLAY_OUTPUT_DIR;
let pass = 0, fail = 0, browser;
const clients = [], workflows = [], assertions = [];
function check(name, okay) { assertions.push({ name, okay }); console.log((okay ? "✅ " : "❌ ") + name); if (okay) pass++; else fail++; }
async function client() { const value = await request.newContext({ baseURL: base, timeout: 120_000 }); clients.push(value); return value; }
async function register(http, email) {
  const response = await http.post("/api/auth/register", { data: { email, password: "admin-test-12345", code: await requestRegistrationCode(http, email) } });
  if (response.status() !== 201) throw Error("隔离注册失败，HTTP " + response.status());
  return response.json();
}
async function login(http, email, password = "admin-test-12345") {
  const csrfToken = (await (await http.get("/api/auth/csrf")).json()).csrfToken;
  await http.post("/api/auth/callback/credentials", { form: { email, password, csrfToken, callbackUrl: base + "/projects" }, headers: { "X-Auth-Return-Redirect": "1" } });
  return (await (await http.get("/api/auth/session")).json())?.user;
}
async function json(http, path, data) { const response = data === undefined ? await http.get(path) : await http.post(path, { data }); if (!response.ok()) throw Error("准备数据失败，HTTP " + response.status() + " " + path); return response.json(); }
async function count() { return (await (await fetch(new URL("/stats", process.env.V144_PROVIDER_FIXTURE_URL))).json()).count; }
async function list(http, query = "") { return json(http, "/api/admin/users" + query); }
async function oldChat(http, tab, content, name) {
  const response = await http.post("/api/tabs/" + tab.id + "/chat", { data: { content, expectedVersion: tab.version, requestId: randomUUID() } });
  // HTTP 200 只表示流已打开；读完所有事件，确认终态与真实回复。
  const text = await response.text();
  const events = text.split(/\r?\n\r?\n/).map(frame => frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n")).filter(Boolean).map(data => JSON.parse(data));
  const done = events.find(event => event.type === "done");
  const okay = response.ok() && response.headers()["content-type"]?.includes("text/event-stream") && !events.some(event => event.type === "error") && done?.status === "completed" && typeof done.messageId === "string" && !!done.content?.trim();
  check(name, okay);
  if (!okay) throw Error(name + "：HTTP " + response.status() + "，未得到无错误的完成回复");
  return done;
}
async function stageMessage(http, path, content, name) {
  const response = await http.post(path, { data: { content, requestId: randomUUID() } });
  const body = await response.json();
  check(name, response.ok() && body.assistantMessage?.status === "completed" && !!body.assistantMessage?.content?.trim());
  const stored = await json(http, path);
  check(name + "且回复已持久化", typeof body.assistantMessage?.id === "string" && stored.messages.some(message => message.id === body.assistantMessage.id && message.status === "completed" && message.content === body.assistantMessage.content));
}
async function newStage(http, name) {
  const project = await json(http, "/api/projects", { name });
  const iteration = await json(http, "/api/projects/" + project.id + "/iterations", { displayName: name });
  const session = await json(http, "/api/iterations/" + iteration.id + "/stages/analysis/sessions", {});
  return { project, path: "/api/iterations/" + iteration.id + "/stages/analysis/sessions/" + session.session.id + "/messages" };
}
async function browserContext(options = {}) {
  const context = await browser.newContext(options);
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(120_000);
  return context;
}
try {
  if (!/^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE ?? "") || !process.env.V144_ADMIN_EMAIL || !/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(process.env.V144_PROVIDER_FIXTURE_URL ?? "")) throw Error("拒绝脱离隔离环境运行");
  const anonymous = await client(), admin = await client(), normal = await client(), target = await client(), legacy = await client();
  const adminEmail = process.env.V144_ADMIN_EMAIL, email = "target-" + randomUUID() + "@test.local", normalEmail = "normal-" + randomUUID() + "@test.local";
  const adminUser = await register(admin, adminEmail), user = await register(target, email);
  const normalUser = await register(normal, normalEmail);
  check("指定管理员正常登录", (await login(admin, adminEmail))?.id === adminUser.id);
  check("普通用户正常登录", !!(await login(normal, normalEmail)));
  check("目标用户停用前正常登录", (await login(target, email))?.id === user.id);
  check("增量迁移保留旧账号且仍可登录", !!(await login(legacy, process.env.V144_LEGACY_EMAIL, process.env.V144_LEGACY_PASSWORD)));
  const legacyFile = await json(legacy, "/api/projects/" + process.env.V144_LEGACY_PROJECT_ID + "/files/" + process.env.V144_LEGACY_FILE_ID);
  check("增量升级保留原有资料正文", JSON.stringify(legacyFile).includes("升级前原始资料，不应被邮箱验证升级覆盖。"));
  for (const [who, http, status] of [["匿名", anonymous, 401], ["普通用户", normal, 403]]) {
    for (const path of ["/api/admin/users", "/api/admin/users?q=" + email, "/api/admin/users?userId=" + adminUser.id]) {
      const response = await http.get(path, { headers: { "x-admin-email": adminEmail } });
      check(who + "无法读取用户列表或伪造身份", response.status() === status && !(await response.text()).includes(email));
    }
    for (const id of [user.id, randomUUID()]) {
      const response = await http.post("/api/admin/users/" + id + "/disable", { data: { reason: "越权请求", actorId: adminUser.id, role: "admin" } });
      check(who + "跨账号操作不泄露账号存在性", response.status() === status && !(await response.text()).includes(email));
    }
  }
  check("管理员查询受保护且禁止缓存", (await admin.get("/api/admin/users")).headers()["cache-control"]?.includes("no-store"));
  const initial = await list(admin);
  check("返回实际用户汇总", initial.summary.total === 4 && initial.summary.active === 4 && initial.summary.disabled === 0);
  check("管理列表仅含运营字段", initial.users.every(u => Object.keys(u).every(key => ["id", "email", "nickname", "status", "createdAt", "disabledAt", "disabledBy", "disabledReason", "giftAvailable", "purchasedAvailable"].includes(key))));
  check("邮箱查询精确找到目标", (await list(admin, "?q=" + encodeURIComponent(email))).users[0]?.id === user.id);
  check("账号 ID 查询找到目标", (await list(admin, "?q=" + user.id)).total === 1);
  check("查询把通配符按字面处理", (await list(admin, "?q=%25")).total === 0);
  for (const query of ["?page=0", "?page=1.5", "?status=other", "?q=" + "a".repeat(321)]) check("错误查询参数返回 400", (await admin.get("/api/admin/users" + query)).status() === 400);
  for (let i = 0; i < 20; i++) await register(anonymous, "page-" + i + "-" + randomUUID() + "@test.local");
  const first = await list(admin), second = await list(admin, "?page=2");
  check("查询和分页保留真实汇总", first.summary.total === 24 && first.total === 24 && first.users.length === 20 && second.users.length === 4);
  check("稳定分页没有重复账号", new Set([...first.users, ...second.users].map(u => u.id)).size === 24);
  check("空结果和超界页正常处理", (await list(admin, "?q=not-found&page=999")).total === 0 && (await list(admin, "?page=999")).page === 2);
  workflows.push("http-authorization-search-pagination-and-upgrade");

  // #04 后新账号没有默认额度；经正式管理员接口提供已知赠送余额，不绕过权限或计费。
  for (const [http, account] of [[target, user], [normal, normalUser], [admin, adminUser]]) {
    await json(admin, "/api/admin/users/" + account.id + "/credits", { requestId: randomUUID(), type: "grant", amount: "10000", reason: "管理员控制隔离回归已知测试余额" });
    const statement = await json(http, "/api/credits");
    check("模型夹具账号取得已知10000赠送积分且无购买余额", statement.balance.gift.available === "10000" && statement.balance.gift.reserved === "0" && statement.balance.purchased.available === "0" && statement.balance.purchased.reserved === "0");
  }
  // 先证明同一旧会话真实到达供应商边界，再做停用后的零新增调用比较。
  const project = await json(target, "/api/projects", { name: "停用前资料" });
  const record = await json(target, "/api/projects/" + project.id + "/work-records", {});
  const tab = await json(target, "/api/work-records/" + record.id + "/tabs", { agent_type: "requirement_analyst" });
  const tabPath = "/api/tabs/" + tab.tab.id + "/chat";
  const { path: messagesPath } = await newStage(target, "停用测试新版迭代");
  const before = await count();
  await stageMessage(target, messagesPath, "测试正常调用", "停用前阶段会话可调用模型");
  const done = await oldChat(target, tab.tab, "测试正常调用", "停用前旧聊天可调用模型且 SSE 完整完成");
  const file = await json(target, "/api/projects/" + project.id + "/files", { filename: "需求分析.md", content: "正文保护样本，不应出现在后台列表。", agent_type: "requirement_analyst", source_message_id: done.messageId });
  check("通过正式来源消息创建资料并持久保留正文", (await json(target, "/api/projects/" + project.id + "/files/" + file.id)).content.includes("正文保护样本，不应出现在后台列表。"));
  const polishPath = "/api/projects/" + project.id + "/files/" + file.id + "/polish";
  const polished = await target.post(polishPath, { data: { content: "测试润色", requestId: randomUUID() } });
  check("停用前润色可调用模型且返回正文", polished.ok() && !!(await polished.json()).polished?.trim());
  check("三个入口确实发生供应商请求", await count() === before + 3);
  const charged = await json(target, "/api/credits");
  check("三个入口可靠用量均已结算且仍有余额可供停用检查", charged.balance.gift.reserved === "0" && Number(charged.balance.gift.available) > 0 && Number(charged.balance.gift.available) < 10000 && charged.balance.purchased.available === "0" && charged.entries.filter(entry => entry.businessType === "model_settle").length === 3);
  const mutation = "/api/admin/users/" + user.id + "/disable";
  check("不允许管理员停用自己", (await admin.post("/api/admin/users/" + adminUser.id + "/disable", { data: { reason: "自身停用" } })).status() === 409);
  check("不存在账号安全返回 404", (await admin.post("/api/admin/users/" + randomUUID() + "/disable", { data: { reason: "不存在" } })).status() === 404);
  check("停用需要有效说明", (await admin.post(mutation, { data: { reason: " " } })).status() === 400);
  check("过长说明被拒绝", (await admin.post(mutation, { data: { reason: "字".repeat(501) } })).status() === 400);
  check("跨站提交被拒绝", (await admin.post(mutation, { data: { reason: "跨站" }, headers: { Origin: "https://other.invalid" } })).status() === 403);
  check("表单跨站提交被拒绝", (await admin.post(mutation, { form: { reason: "跨站表单" } })).status() === 403);
  check("拒绝过大请求体", (await admin.post(mutation, { data: { reason: "x".repeat(5000) } })).status() === 413);
  workflows.push("normal-model-entrypoints-and-mutation-validation");

  browser = await chromium.launch({ channel: "msedge", headless: true });
  const normalContext = await browserContext({ storageState: await normal.storageState() }), normalPage = await normalContext.newPage();
  await normalPage.goto(base + "/admin");
  check("普通用户页面无法读取后台", await normalPage.getByRole("heading", { name: "无权访问管理后台" }).isVisible() && !(await normalPage.locator("body").innerText()).includes(email));
  await normalPage.goto(base + "/profile");
  check("普通用户个人中心不显示管理入口", await normalPage.getByRole("link", { name: "管理后台", exact: true }).count() === 0);
  const anonymousPage = await (await browserContext()).newPage(); await anonymousPage.goto(base + "/admin");
  check("匿名访问后台页面跳转登录", new URL(anonymousPage.url()).pathname === "/login");
  const adminContext = await browserContext({ storageState: await admin.storageState(), viewport: { width: 1440, height: 1000 } }), page = await adminContext.newPage();
  await page.goto(base + "/profile"); await page.getByRole("link", { name: "管理后台", exact: true }).click();
  await page.getByRole("heading", { name: "用户管理", exact: true }).waitFor();
  check("管理员从个人中心进入后台", new URL(page.url()).pathname === "/admin");
  await page.screenshot({ path: join(output, "admin-desktop-list.png"), fullPage: true, caret: "initial" });
  await page.getByRole("link", { name: "下一页", exact: true }).click();
  // Link 导航异步提交；等 URL 和服务端页面终态后再核对行数，不能只等点击完成。
  await page.waitForURL(url => url.searchParams.get("page") === "2");
  await page.getByRole("navigation", { name: "用户分页" }).getByText("第 2 / 2 页", { exact: true }).waitFor();
  check("页面分页到第二页且保留剩余四个账号", new URL(page.url()).searchParams.get("page") === "2" && await page.locator("tbody tr").count() === 4);
  await page.screenshot({ path: join(output, "admin-desktop-page2.png"), fullPage: true, caret: "initial" });
  await page.getByRole("link", { name: "上一页", exact: true }).click();
  await page.waitForURL(url => url.searchParams.get("page") === "1");
  await page.getByRole("navigation", { name: "用户分页" }).getByText("第 1 / 2 页", { exact: true }).waitFor();
  await page.getByLabel("账号邮箱或完整 ID").fill(email); await page.getByRole("button", { name: "查询", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: email }); await row.waitFor();
  check("页面筛选显示目标账号", await row.count() === 1);
  await page.screenshot({ path: join(output, "admin-desktop.png"), fullPage: true, caret: "initial" });
  await row.getByRole("button", { name: "停用 " + email, exact: true }).click();
  await row.getByLabel("停用说明", { exact: true }).fill("异常使用核实，暂停新增请求。<script>示例</script>");
  await page.screenshot({ path: join(output, "admin-disable-confirm.png"), fullPage: true, caret: "initial" });
  const [disabledResponse] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === mutation && r.request().method() === "POST"), row.getByRole("button", { name: "确认停用", exact: true }).click()]);
  check("页面停用正式提交成功", disabledResponse.status() === 200);
  await row.getByText("已停用", { exact: true }).waitFor(); await page.reload();
  check("刷新后停用状态与说明持久存在", await row.getByText("已停用", { exact: true }).isVisible() && (await row.innerText()).includes("<script>示例</script>"));
  const persisted = (await list(admin, "?q=" + user.id)).users[0];
  check("审计记录操作者、时间和业务说明", persisted.disabledBy === adminUser.id && !!persisted.disabledAt && persisted.disabledReason === "异常使用核实，暂停新增请求。<script>示例</script>");
  check("停用后用户数量汇总正确", (await list(admin)).summary.disabled === 1 && (await list(admin, "?status=disabled")).total === 1 && (await list(admin, "?status=active")).total === 23);
  const duplicate = await Promise.all([admin.post(mutation, { data: { reason: "重复说明一" } }), admin.post(mutation, { data: { reason: "重复说明二" } })]);
  const repeated = (await list(admin, "?q=" + user.id)).users[0];
  check("重复停用语义稳定且不覆盖原审计", duplicate.every(r => r.status() === 200) && repeated.disabledReason === persisted.disabledReason && repeated.disabledAt === persisted.disabledAt);
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
  check("窄屏页面无整体横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const tableRegion = page.getByRole("region", { name: "用户列表，可横向滚动" });
  await tableRegion.focus();
  check("窄屏表格可键盘访问且独立滚动", await tableRegion.getAttribute("tabindex") === "0" && await tableRegion.evaluate(element => element === document.activeElement && element.scrollWidth > element.clientWidth && ["auto", "scroll"].includes(getComputedStyle(element).overflowX)));
  check("后台只有一个主要内容地标", await page.getByRole("main").count() === 1);
  await page.screenshot({ path: join(output, "admin-mobile.png"), fullPage: true, caret: "initial" });
  await tableRegion.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await page.screenshot({ path: join(output, "admin-mobile-audit.png"), fullPage: true, caret: "initial" });
  check("后台不含用户正文", !(await page.locator("body").innerText()).includes("正文保护样本"));
  workflows.push("admin-page-desktop-mobile-and-persistent-audit");

  const upstream = await count();
  for (const [name, path, data] of [["阶段会话", messagesPath, { content: "停用后尝试", requestId: randomUUID() }], ["旧聊天", tabPath, { content: "停用后尝试", expectedVersion: done.tabVersion, requestId: randomUUID() }], ["润色", polishPath, { content: "停用后尝试", requestId: randomUUID() }]]) {
    const response = await target.post(path, { data }); check("停用前取得的旧登录状态不能继续" + name, response.status() === 403);
  }
  check("停用后供应商新增调用为零", await count() === upstream);
  const fresh = await client(); check("停用账号不能重新登录", !(await login(fresh, email)));
  check("旧状态不能继续管理或业务 API", (await target.get("/api/projects")).status() === 403 && (await target.get("/api/admin/users")).status() === 403);
  const resetPassword = "admin-reset-12345";
  const resetCode = await anonymous.post("/api/auth/email-code", { data: { email, purpose: "reset-password" } });
  check("停用账号仍可通过正式入口申请找回验证码", resetCode.status() === 200);
  const reset = await anonymous.post("/api/auth/reset-password", { data: { email, code: await latestEmailCode(email, "reset-password"), password: resetPassword } });
  check("停用账号通过正式验证码完成密码重置", reset.status() === 200);
  const afterReset = await client();
  check("重置密码不会重新激活停用账号", !(await login(afterReset, email, resetPassword)));
  const resetUser = (await list(admin, "?q=" + user.id)).users[0];
  check("重置后停用状态和原审计仍然持久保留", resetUser.status === "disabled" && resetUser.disabledBy === persisted.disabledBy && resetUser.disabledAt === persisted.disabledAt && resetUser.disabledReason === persisted.disabledReason);
  check("停用与重置流程未额外调用供应商", await count() === upstream);
  const normalStage = await newStage(normal, "正常账号模型保持");
  const normalBefore = await count();
  await stageMessage(normal, normalStage.path, "其他账号停用后继续正常使用", "正常用户仍可生成模型回复");
  check("正常用户请求确实到达供应商", await count() === normalBefore + 1);
  const adminStage = await newStage(admin, "管理员正常产品能力");
  const adminBefore = await count();
  await stageMessage(admin, adminStage.path, "管理员以普通产品用户身份生成", "管理员仍可正常生成模型回复");
  check("管理员正常模型请求确实到达供应商", await count() === adminBefore + 1);
  check("正常用户仍可新增项目", (await normal.post("/api/projects", { data: { name: "正常账号不受影响" } })).status() === 201);
  check("停用不删除原账号和旧升级项目", (await list(admin, "?q=" + user.id)).users[0]?.id === user.id && (await json(legacy, "/api/projects")).some(p => p.id === process.env.V144_LEGACY_PROJECT_ID));
  check("旧升级资料在停用与重置后正文仍保持", JSON.stringify(await json(legacy, "/api/projects/" + process.env.V144_LEGACY_PROJECT_ID + "/files/" + process.env.V144_LEGACY_FILE_ID)).includes("升级前原始资料，不应被邮箱验证升级覆盖。"));
  const crossProject = await admin.get("/api/projects/" + project.id + "/files/" + file.id);
  check("管理员身份不提供跨账号正文特权", crossProject.status() === 404);
  workflows.push("old-session-denial-zero-provider-calls-and-account-isolation");
} catch (error) { check(String(error.message).split("\n")[0], false); }
finally {
  await browser?.close(); for (const http of clients) await http.dispose();
  await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, aiMode: "replay", workflows, assertions }, null, 2));
  console.log("结果: " + pass + " 通过, " + fail + " 失败");
}
process.exit(fail > 0 ? 1 : 0);
