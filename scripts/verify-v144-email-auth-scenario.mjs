// v1.44 #02：只通过真实 HTTP / 浏览器观察认证；邮件和时间只在隔离外部边界替身控制。
import { chromium, request } from "playwright-core";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixtureRequest, latestEmailCode } from "./verify-email-fixture.mjs";

const base = process.env.BASE_URL;
const output = process.env.V141_REPLAY_OUTPUT_DIR;
const started = Date.now();
const suffix = randomUUID().slice(0, 8);
const password = randomBytes(18).toString("hex");
const nextPassword = randomBytes(18).toString("hex");
const secrets = new Set([password, nextPassword, process.env.V144_LEGACY_PASSWORD, process.env.AUTH_SECRET, process.env.V144_EMAIL_TEST_TOKEN].filter(Boolean));
const observations = [], failures = [], skipped = [], screenshots = [], workflows = [];
const contexts = [];
const budget = { send: 0, verify: 0, action: 0 };
let pass = 0, fail = 0, browser, http, preLimiterRejects = 0;
let active = "隔离门禁";
const email = label => `v144-${suffix}-${label}@test.local`;
const paths = { send: "/api/auth/email-code", register: "/api/auth/register", reset: "/api/auth/reset-password" };
const wrong = code => (Number(code) + 1).toString().padStart(6, "0").slice(-6);
function safe(error) {
  let text = String(error?.message ?? error).split("\n")[0];
  for (const secret of secrets) text = text.replaceAll(secret, "<已隐藏>");
  return text.replace(/\b\d{6}\b/g, "<已隐藏>").replace(/(authorization|cookie|password|csrfToken)\s*[:=].*/gi, "$1=<已隐藏>");
}
function check(name, okay, detail = {}) {
  const entry = { name, passed: Boolean(okay), ...detail };
  observations.push(entry);
  if (okay) { pass++; console.log("✅ " + name); }
  else { fail++; failures.push({ group: active, ...entry }); console.error("❌ " + name); }
  return Boolean(okay);
}
function need(name, okay, detail) {
  if (!check(name, okay, detail)) { const error = new Error(name); error.counted = true; throw error; }
}
async function group(name, run) {
  active = name;
  try { await run(); }
  catch (error) {
    if (!error.counted) check(name + "中断：" + safe(error), false);
  }
}
async function unpack(response) {
  const status = response.status();
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  const headers = response.headers();
  if (status === 403 && /跨站/.test(data?.error ?? "")) preLimiterRejects++;
  // 不把正文、请求参数、验证码或凭据写入证据。只记录结构检查结果。
  const clean = !/\b\d{6}\b/.test(text) && ![...secrets].some(secret => text.includes(secret)) && !/"(?:code|password|password_hash|csrfToken|access_token|stack)"\s*:/i.test(text);
  const json = /application\/json/i.test(headers["content-type"] ?? "");
  const envelope = json && data !== null && typeof data === "object" && !Array.isArray(data) && (status < 400 || (typeof data.error === "string" && data.error.trim().length > 0));
  return { status, data, clean, envelope, retry: Number(headers["retry-after"]) };
}
function expect(name, result, status, message) {
  const statuses = Array.isArray(status) ? status : [status];
  return check(name, statuses.includes(result.status) && result.clean && result.envelope && (!message || message.test(result.data?.error ?? result.data?.message ?? "")), { status: result.status, expected: statuses, clean: result.clean, errorEnvelope: result.envelope });
}
function rate(name, result) {
  expect(name, result, 429, /频繁|等待|次数/);
  check(name + "包含可操作重试时间", Number.isFinite(result.retry) && result.retry > 0 && Number.isInteger(result.data?.retryAfter) && result.data.retryAfter === result.retry);
}
async function post(action, data, options = {}) {
  budget.action++;
  if (options.count === "send") budget.send++;
  if (options.count === "verify") budget.verify++;
  const response = await http.post(paths[action], {
    headers: { "content-type": "application/json", ...options.headers },
    data: options.raw !== undefined ? options.raw : JSON.stringify(data),
  });
  const result = await unpack(response);
  if (result.status === 403) {
    if (options.count === "send") budget.send--;
    if (options.count === "verify") budget.verify--;
  }
  return result;
}
const send = (address, purpose = "register") => post("send", { email: address, purpose }, { count: "send" });
const submit = (action, address, code, pw = password) => post(action, { email: address, password: pw, code }, { count: "verify" });
async function codeFor(address, purpose = "register") {
  const code = await latestEmailCode(address, purpose);
  secrets.add(code);
  need("邮件边界提供六位数字验证码", /^\d{6}$/.test(code));
  return code;
}
async function session(client) { return (await (await client.get(base + "/api/auth/session")).json()) ?? {}; }
async function client() {
  const context = await request.newContext({ baseURL: base, timeout: 45_000 });
  contexts.push(context); return context;
}
async function login(context, address, pw) {
  const csrf = (await (await context.get(base + "/api/auth/csrf")).json()).csrfToken;
  secrets.add(csrf);
  await context.post(base + "/api/auth/callback/credentials", { form: { email: address, password: pw, csrfToken: csrf, callbackUrl: base + "/projects" }, headers: { "X-Auth-Return-Redirect": "1" } });
  return session(context);
}
async function signout(context) {
  const csrf = (await (await context.get(base + "/api/auth/csrf")).json()).csrfToken;
  secrets.add(csrf);
  await context.post(base + "/api/auth/signout", { form: { csrfToken: csrf, callbackUrl: base + "/" }, headers: { "X-Auth-Return-Redirect": "1" } });
}
async function noAccount(name, address, pw = password) {
  const context = await client();
  check(name, !(await login(context, address, pw)).user);
}
async function screenshot(page, name) {
  const filename = name + ".png";
  await page.screenshot({ path: join(output, filename), fullPage: true, mask: [page.locator('input[type="password"], input[type="email"], #emailCode')] });
  screenshots.push(filename);
}
async function browserAction(page, action, trigger) {
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === paths[action] && r.request().method() === "POST"), trigger(),
  ]);
  const result = await unpack(response);
  if (result.status === 403) { if (action === "send") budget.send--; else budget.verify--; }
  return result;
}

try {
  need("仅在随机隔离库与 replay 邮件边界运行", Boolean(base && output && process.env.AI_MODE === "replay" && /^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE ?? "") && process.env.V144_EMAIL_TEST_URL && process.env.V144_EMAIL_TEST_TOKEN));
  http = await client();
  await group("旧账号增量升级", async () => {
    const address = process.env.V144_LEGACY_EMAIL;
    const pw = process.env.V144_LEGACY_PASSWORD;
    const projectId = process.env.V144_LEGACY_PROJECT_ID;
    const fileId = process.env.V144_LEGACY_FILE_ID;
    if (![address, pw, projectId, fileId].every(Boolean)) {
      skipped.push({ name: "旧账号与旧项目资料升级回归", reason: "launcher 未提供完整旧账号夹具；未计通过" });
      console.log("⏭ 旧账号夹具缺失，升级回归跳过且不计通过"); return;
    }
    const legacy = await client();
    need("旧账号无需验证码即可登录", (await login(legacy, address, pw)).user?.email === address);
    const projects = await legacy.get(`/api/projects`);
    check("升级前项目仍在旧账号列表", projects.status() === 200 && (await projects.json()).some(p => p.id === projectId && p.name === "升级前项目"));
    const files = await legacy.get(`/api/projects/${projectId}/files`);
    check("升级前资料仍在项目文件列表", files.status() === 200 && (await files.json()).some(f => f.id === fileId && f.filename === "升级前资料.md"));
    const file = await legacy.get(`/api/projects/${projectId}/files/${fileId}`);
    check("升级前文件正文逐字保留", file.status() === 200 && (await file.json()).content === "升级前原始资料，不应被邮箱验证升级覆盖。");
  });

  await group("异常请求与错误格式", async () => {
    const cases = [
      ["空正文", "send", "", 400], ["破损 JSON", "register", "{", 400],
      ["null 正文", "reset", "null", 400], ["数组正文", "send", "[]", 400], ["字符串正文", "register", '"x"', 400],
      ["超长正文", "reset", "x".repeat(4097), 413],
      ["缺失邮箱", "send", {}, 400], ["邮箱类型错误", "send", { email: 42, purpose: "register" }, 400],
      ["邮箱格式错误", "send", { email: "broken", purpose: "register" }, 400],
      ["邮箱超长", "send", { email: "x".repeat(321) + "@test.local", purpose: "register" }, 400],
      ["未知用途", "send", { email: email("malformed"), purpose: "login" }, 400],
      ["缺失用途", "send", { email: email("malformed") }, 400],
      ["密码过短", "register", { email: email("malformed"), password: "a", code: "000000" }, 400],
      ["密码超过字节限制", "reset", { email: email("malformed"), password: "密".repeat(25), code: "000000" }, 400],
    ];
    for (const [name, action, body, status] of cases) {
      expect(name + "有明确 JSON 错误", await post(action, typeof body === "string" ? undefined : body, typeof body === "string" ? { raw: body } : {}), status);
    }
    expect("跨站认证提交被拒绝", await post("send", { email: email("origin"), purpose: "register" }, { headers: { origin: "https://untrusted.example" } }), 403);
    expect("数字型验证码被拒绝", await submit("register", email("format"), 123456), 400, /6 位|格式/);
    expect("非六位验证码被拒绝", await submit("reset", email("format"), "12345"), 400, /6 位|格式/);
    expect("浏览器同源 Origin 的坏格式提交应进入 JSON 校验", await post("send", null, { raw: "{", headers: { origin: new URL(base).origin } }), 400, /格式/);
    for (const path of Object.values(paths)) check("认证写入接口拒绝 GET " + path, (await http.get(path)).status() === 405);
  });

  const primary = email("primary");
  let primaryProject;
  await group("注册码生命周期与隔离", async () => {
    const issued = await send(primary);
    expect("公开 API 发送注册码成功且不泄露秘密", issued, 200);
    check("服务端说明十分钟有效及六十秒重发", issued.data?.expiresIn === 600 && issued.data?.retryAfter === 60);
    const old = await codeFor(primary);
    await fixtureRequest("/advance", { seconds: 59 });
    rate("未满六十秒仍不能重发", await send(primary));
    await fixtureRequest("/advance", { seconds: 2 });
    expect("满六十秒后允许重发", await send(primary), 200);
    let latest = await codeFor(primary);
    // 百万分之一的随机同码也不让 latest-only 断言偶发失败。
    for (let retry = 0; latest === old && retry < 2; retry++) {
      await fixtureRequest("/advance", { seconds: 61 });
      expect("随机同码时重新获取可区分的新码", await send(primary), 200);
      latest = await codeFor(primary);
    }
    need("新旧验证码可区分", latest !== old);
    expect("重发后旧码无效", await submit("register", primary, old), 400, /错误|失效/);
    expect("注册码不能跨邮箱使用", await submit("register", email("other"), latest), 400);
    expect("注册码不能用于密码找回", await submit("reset", primary, latest), 400);
    expect("错误码返回可操作反馈", await submit("register", primary, wrong(latest)), 400, /错误/);
    await noAccount("验证失败未提前创建账号", primary);
    const created = await submit("register", "  " + primary.toUpperCase() + "  ", latest);
    need("仅最新正确码可创建规范化邮箱账号", created.status === 201 && created.clean && created.envelope && created.data?.email === primary);
    expect("已经消费的注册码不能再次使用", await submit("register", primary, latest), 400, /已使用/);
    const authenticated = await client();
    const before = budget.send;
    need("正常邮箱密码登录无需再次发码", (await login(authenticated, primary, password)).user?.email === primary && budget.send === before);
    const project = await authenticated.post("/api/projects", { data: { name: "邮箱认证持久项目" } });
    need("正式 API 创建持久项目", project.status() === 201);
    primaryProject = (await project.json()).id;
    await signout(authenticated);
    check("HTTP 退出后会话为空", !(await session(authenticated)).user);
    check("HTTP 退出后项目 API 拒绝访问", (await authenticated.get("/api/projects")).status() === 401);
    await fixtureRequest("/advance", { seconds: 61 });
  });

  await group("重音等价邮箱不能找回原账号", async () => {
    const lookalike = primary.replace("@test.local", "@tést.local");
    expect("重音相似但不同地址申请找回明确返回 404", await send(lookalike, "reset-password"), 404, /尚未注册/);
    // 仅观察邮件外部边界，不能读取验证码表或保存邮件正文。
    const messages = await fixtureRequest("/messages");
    check("邮件边界没有向重音相似地址投递验证码", !messages.some(message => message.email === lookalike));
    const original = await client();
    check("重音相似地址找回失败后原账号密码仍可登录", (await login(original, primary, password)).user?.email === primary);
  });
  await group("找回码安全、并发消费与持久项目", async () => {
    expect("已注册邮箱可申请找回码", await send(primary, "reset-password"), 200);
    const resetCode = await codeFor(primary, "reset-password");
    expect("找回码不能用作注册验证码", await submit("register", primary, resetCode), 400, /使用|错误|用途/);
    expect("找回码不能跨邮箱使用", await submit("reset", email("other"), resetCode), 400);
    expect("错误找回码有明确反馈", await submit("reset", primary, wrong(resetCode)), 400, /错误/);
    await fixtureRequest("/advance", { seconds: 61 });
    expect("找回码满六十秒可重发", await send(primary, "reset-password"), 200);
    const latestReset = await codeFor(primary, "reset-password");
    need("找回重发新旧码可区分", latestReset !== resetCode);
    expect("重发后旧找回码失效", await submit("reset", primary, resetCode), 400, /错误|失效/);
    await fixtureRequest("/advance", { seconds: 601 });
    expect("超过十分钟的找回码失效", await submit("reset", primary, latestReset), 400, /过期/);
    const stillOld = await client();
    check("错误和过期找回码不会更改原密码", (await login(stillOld, primary, password)).user?.email === primary);
    expect("过期后可重新获取找回码", await send(primary, "reset-password"), 200);
    const fresh = await codeFor(primary, "reset-password");
    const resets = await Promise.all([submit("reset", primary, fresh, nextPassword), submit("reset", primary, fresh, nextPassword)]);
    check("并发找回对同一码仅消费成功一次", resets.filter(r => r.status === 200).length === 1 && resets.filter(r => r.status === 400 && /已使用/.test(r.data?.error ?? "")).length === 1 && resets.every(r => r.clean && r.envelope), { statuses: resets.map(r => r.status) });
    expect("已消费找回码不能再次重置", await submit("reset", primary, fresh, password), 400, /已使用/);
    await noAccount("重置后原密码不再能登录", primary, password);
    const recovered = await client();
    need("重置后的新密码直接登录成功", (await login(recovered, primary, nextPassword)).user?.email === primary);
    const projects = await recovered.get("/api/projects");
    check("找回重登后原项目仍属于同一账号", projects.status() === 200 && Boolean(primaryProject) && (await projects.json()).some(p => p.id === primaryProject && p.name === "邮箱认证持久项目"));
    expect("未注册邮箱找回明确返回错误", await send(email("missing"), "reset-password"), 404, /尚未注册/);
  });

  await group("注册码过期", async () => {
    const address = email("expired");
    expect("申请过期场景注册码", await send(address), 200);
    const code = await codeFor(address);
    await fixtureRequest("/advance", { seconds: 601 });
    expect("十分钟后注册码明确过期", await submit("register", address, code), 400, /过期/);
    await noAccount("过期验证码未创建可登录账号", address);
  });
  await group("每码五次错误与恢复", async () => {
    const address = email("attempts");
    expect("申请错误次数场景验证码", await send(address), 200);
    const code = await codeFor(address);
    for (let i = 1; i <= 5; i++) expect("同一码第 " + i + " 次错误明确拒绝", await submit("register", address, wrong(code)), 400, /错误/);
    rate("五次错误后正确码也不能使用", await submit("register", address, code));
    await noAccount("次数锁定未创建账号", address);
    await fixtureRequest("/advance", { seconds: 61 });
    expect("重新获取验证码解除单码锁定", await send(address), 200);
    expect("新码可成功注册", await submit("register", address, await codeFor(address)), 201);
  });
  await group("重复邮箱并发注册唯一", async () => {
    const address = email("concurrent");
    expect("申请并发注册验证码", await send(address), 200);
    const code = await codeFor(address);
    const results = await Promise.all([submit("register", address, code, password), submit("register", address, code, nextPassword)]);
    const winner = results.findIndex(r => r.status === 201);
    need("并发重复注册只产生一个成功账号", winner >= 0 && results.filter(r => r.status === 201).length === 1 && results.every(r => r.clean && r.envelope) && results.filter(r => [400, 409].includes(r.status)).length === 1, { statuses: results.map(r => r.status) });
    const signed = await client();
    const winningPassword = winner === 0 ? password : nextPassword;
    const user = (await login(signed, address, winningPassword)).user;
    check("并发赢家账号身份与注册返回一致", user?.email === address && user?.id === results[winner].data?.id);
    await noAccount("并发失败方不能覆盖赢家密码", address, winner === 0 ? nextPassword : password);
    await fixtureRequest("/advance", { seconds: 61 });
    expect("重复邮箱申请注册码明确拒绝", await send(address), 409, /已被注册/);
  });
  await group("邮件发送失败", async () => {
    const address = email("delivery");
    expect("先投递用于检验失败重发撤销的旧验证码", await send(address), 200);
    const priorCode = await codeFor(address);
    await fixtureRequest("/advance", { seconds: 61 });
    const count = (await fixtureRequest("/messages")).length;
    try {
      await fixtureRequest("/mode", { mode: "failure" });
      const failed = await send(address);
      expect("邮件投递失败明确返回 503", failed, 503, /发送|邮件|投递/);
      check("发送失败响应提供重试时间", failed.retry > 0 && failed.data?.retryAfter === failed.retry);
      check("发送失败不伪造邮件投递", (await fixtureRequest("/messages")).length === count);
      expect("重发失败后旧邮件验证码也不能建号", await submit("register", address, priorCode), 400, /尚未发送成功|重新获取/);
      await noAccount("发送失败未留下可登录账号", address);
    } finally { await fixtureRequest("/mode", { mode: "success" }); }
    await fixtureRequest("/advance", { seconds: 61 });
    expect("邮件服务恢复后可重试发送", await send(address), 200);
    expect("恢复投递后可正常注册", await submit("register", address, await codeFor(address)), 201);
  });

  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1440, 390]) await group(width + "px 浏览器完整流程", async () => {
    const address = email("browser-" + width);
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000); page.setDefaultNavigationTimeout(60_000);
    page.on("request", req => {
      if (req.method() !== "POST") return;
      const path = new URL(req.url()).pathname;
      if (!Object.values(paths).includes(path)) return;
      budget.action++;
      if (path === paths.send) budget.send++; else budget.verify++;
    });
    try {
      await page.goto(base + "/register");
      check(width + "px 注册显示验证码有效期和 latest-only 规则", await page.getByText("10 分钟内有效；重新发送后仅最新验证码有效。", { exact: true }).isVisible());
      check(width + "px 注册不要求原共享邀请码", await page.locator('input[required][name*="invite"], input[required][id*="invite"]').count() === 0);
      await page.fill("#email", address);
      await page.fill("#password", password);
      await page.fill("#confirmPassword", password);
      const registrationSend = await browserAction(page, "send", () => page.getByRole("button", { name: "获取验证码", exact: true }).click());
      await screenshot(page, width + "-register-send-result");
      need(width + "px 浏览器申请注册验证码", registrationSend.status === 200 && registrationSend.clean && registrationSend.envelope, { status: registrationSend.status, expected: [200] });
      await page.getByRole("button", { name: /秒后重发/ }).waitFor();
      check(width + "px 发送后重发按钮禁用", await page.getByRole("button", { name: /秒后重发/ }).isDisabled());
      await screenshot(page, width + "-register-code");
      await page.fill("#emailCode", await codeFor(address));
      expect(width + "px 浏览器正式注册返回成功", await browserAction(page, "register", () => page.locator('form button[type="submit"]').click()), 201);
      await page.waitForURL(url => url.pathname === "/projects");
      need(width + "px 注册自动登录到项目页", (await session(page.request)).user?.email === address);
      const project = await page.request.post(base + "/api/projects", { data: { name: width + "px 找回后保留项目" } });
      need(width + "px 创建持久项目", project.status() === 201);
      const id = (await project.json()).id;
      await page.reload();
      await screenshot(page, width + "-registered-project");
      await page.goto(base + "/profile");
      const [exit] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/signout" && r.request().method() === "POST"), page.getByRole("button", { name: /退出登录/ }).click()]);
      await page.waitForURL(url => url.pathname === "/");
      check(width + "px 点击退出后会话为空", exit.ok() && !(await session(page.request)).user);
      check(width + "px 退出后受保护 API 返回 401", (await page.request.get(base + "/api/projects")).status() === 401);
      await screenshot(page, width + "-signed-out");
      await page.goto(base + "/login");
      check(width + "px 普通登录表单没有验证码", await page.locator("#emailCode").count() === 0);
      await screenshot(page, width + "-login-forgot-entry");
      await page.getByRole("link", { name: /忘记密码/ }).click();
      await page.waitForURL(url => url.pathname === "/forgot-password");
      check(width + "px 登录页入口进入找回密码", await page.getByRole("heading", { name: "找回密码", exact: true }).isVisible());
      await page.fill("#email", address);
      expect(width + "px 浏览器申请找回验证码", await browserAction(page, "send", () => page.getByRole("button", { name: "获取验证码", exact: true }).click()), 200);
      const resetCode = await codeFor(address, "reset-password");
      await page.fill("#password", nextPassword);
      await page.fill("#confirmPassword", nextPassword);
      await page.fill("#emailCode", wrong(resetCode));
      expect(width + "px 找回错误码请求被拒绝", await browserAction(page, "reset", () => page.locator('form button[type="submit"]').click()), 400, /错误/);
      await page.getByRole("alert").filter({ hasText: /验证码错误/ }).waitFor();
      check(width + "px 找回错误在界面明确显示", await page.getByRole("alert").filter({ hasText: /验证码错误/ }).isVisible());
      await screenshot(page, width + "-reset-error");
      await page.fill("#emailCode", resetCode);
      expect(width + "px 浏览器完成密码重置", await browserAction(page, "reset", () => page.locator('form button[type="submit"]').click()), 200);
      await page.getByRole("status").filter({ hasText: /密码已重置/ }).waitFor();
      check(width + "px 重置完成后仍未自动登录", !(await session(page.request)).user);
      await screenshot(page, width + "-reset-complete");
      await page.getByRole("link", { name: "返回登录", exact: true }).click();
      await page.waitForURL(url => url.pathname === "/login");
      await page.fill("#email", address); await page.fill("#password", nextPassword);
      await page.locator('form button[type="submit"]').click();
      await page.waitForURL(url => url.pathname === "/projects");
      need(width + "px 使用新密码登录成功", (await session(page.request)).user?.email === address);
      const list = await page.request.get(base + "/api/projects");
      check(width + "px 找回重登后原项目持久保留", list.status() === 200 && (await list.json()).some(p => p.id === id));
      check(width + "px 页面无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await screenshot(page, width + "-recovered-project");
      observations.push({ name: width + "px 浏览器完整工作流结束", passed: true, viewport: width });
    } finally { await context.close(); }
  });

  await group("邮箱发送频率六次每小时", async () => {
    const address = email("send-limit");
    const before = (await fixtureRequest("/messages")).length;
    for (let i = 1; i <= 6; i++) {
      expect("同邮箱第 " + i + " 次每小时发送允许", await send(address), 200);
      await fixtureRequest("/advance", { seconds: 61 });
    }
    rate("同邮箱第七次发送触发每小时六次上限", await send(address));
    check("邮箱发送限流不多投递邮件", (await fixtureRequest("/messages")).length === before + 6);
  });
  await group("邮箱验证二十次每十五分钟", async () => {
    const address = email("verify-limit");
    for (let i = 1; i <= 20; i++) {
      // 不存在 challenge 的格式正确请求，仍需计入 verify 限流；不同 action 共用邮箱额度。
      expect("同邮箱第 " + i + " 次验证正常校验失败", await submit(i % 2 ? "register" : "reset", address, "000000"), 400);
    }
    rate("跨用途第二十一次验证触发邮箱限流", await submit("reset", address.toUpperCase(), "000000"));
    await noAccount("邮箱验证攻击未创建账号", address);
  });
  await group("开发 IP 共享限流（末尾）", async () => {
    check("正常与邮箱限流场景未超过 IP 发送三十次", budget.send <= 30, { send: budget.send });
    check("正常与邮箱限流场景未超过 IP 验证六十次", budget.verify <= 60, { verify: budget.verify });
    while (budget.send < 30) expect("不同邮箱消耗剩余 IP 发送额度 " + (budget.send + 1), await send(email("ip-send-" + budget.send)), 200);
    rate("第三十一次发送触发共享 IP 限流", await send(email("ip-send-blocked"), "reset-password"));
    while (budget.verify < 60) expect("不同邮箱跨用途消耗剩余 IP 验证额度 " + (budget.verify + 1), await submit(budget.verify % 2 ? "register" : "reset", email("ip-verify-" + budget.verify), "000000"), 400);
    rate("第六十一次验证触发共享 IP 限流", await submit("reset", email("ip-verify-blocked"), "000000"));
    const actions = ["send", "register", "reset"];
    let first429 = null, filler = 0;
    // 坏格式在具体发送/验证限流前失败，只累积跨 action 的通用 IP 桶。
    for (; filler < 155; filler++) {
      const result = await post(actions[filler % 3], null, { raw: "{" });
      if (result.status === 429) { first429 = result; break; }
      expect("坏格式跨 action 累积通用额度 " + (filler + 1), result, 400, /格式/);
    }
    need("跨 action 坏格式最终触发通用一百五十次限流", Boolean(first429));
    check("通用第一百五十一次请求精确触发限流（跨站拒绝不入桶）", budget.action - preLimiterRejects === 151, { action: budget.action, preLimiterRejects });
    rate("通用请求限流有明确错误与重试时间", first429);
    for (const action of actions) rate("通用限流覆盖 action " + action, await post(action, null, { raw: "{" }));
    observations.push({ name: "限流阶段请求预算", passed: true, ...budget, malformedFillers: filler, realQuarterHour: Math.floor(Date.now() / 900_000), realHour: Math.floor(Date.now() / 3_600_000) });
  });
} catch (error) {
  if (!error.counted) check(active + "异常：" + safe(error), false);
} finally {
  await browser?.close().catch(() => {});
  await Promise.allSettled(contexts.map(context => context.dispose()));
  if (fail === 0 && !skipped.length) workflows.push("email-auth-http-browser-desktop-mobile-upgrade");
  else if (fail === 0) workflows.push("email-auth-http-browser-desktop-mobile-legacy-skipped");
  const summary = { pass, fail, skipped, aiMode: "replay", workflows, durationMs: Date.now() - started, budget, screenshots, evidence: "HTTP 与浏览器；邮件外部边界替身；受限时钟；未读取验证码数据库；不代表真实邮件投递" };
  if (output) {
    await writeFile(join(output, "email-auth-observations.json"), JSON.stringify({ observations, failures, skipped, screenshots }, null, 2));
    await writeFile(join(output, "scenario-summary.json"), JSON.stringify(summary, null, 2));
  }
  console.log("结果: " + pass + " 通过, " + fail + " 失败, " + skipped.length + " 跳过");
}
process.exit(fail > 0 ? 1 : 0);
