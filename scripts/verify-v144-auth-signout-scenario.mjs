// v1.44：真实认证 HTTP 与浏览器退出回归；仅由随机空库 launcher 启动。
import { chromium, request } from "playwright-core";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
const base = process.env.BASE_URL;
const output = process.env.V141_REPLAY_OUTPUT_DIR;
let pass = 0; let fail = 0; let browser;
const workflows = []; const observations = [];
function safeError(error) { return String(error?.message ?? error).split("\n")[0].replace(/(cookie|set-cookie|authorization)\s*:\s*.*/gi, "$1: <REDACTED>"); }
function check(name, okay) { console.log((okay ? "✅ " : "❌ ") + name); if (okay) pass++; else fail++; }
// 只记录 Cookie 名称、长度和属性，绝不保存令牌值。
function safeCookies(headers) { return headers.filter(h => h.name.toLowerCase() === "set-cookie").map(h => h.value.replace(/(^|\n)([^=;\n]+)=([^;\n]*)/g, "$1$2=<REDACTED>")); }
function onlyClearsSession(headers) { const values = headers.filter(h => h.name.toLowerCase() === "set-cookie" && /authjs\.session-token(?:\.\d+)?=/.test(h.value)); return values.length > 0 && values.every(h => /Max-Age=0(?:;|$)/i.test(h.value)); }
async function session(client) { return (await client.get(base + "/api/auth/session")).json(); }
try {
  if (!base || !output || process.env.AI_MODE !== "replay" || !/^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE ?? "")) throw new Error("拒绝脱离隔离环境运行");
  const password = "verify-signout-1234";
  // 先用串行 HTTP 重现；不依赖页面加载或客户端并发。
  const client = await request.newContext({ baseURL: base, timeout: 120_000 });
  const email = "verify-signout-" + randomUUID() + "@test.local";
  check("独立账号注册成功", (await client.post("/api/auth/register", { data: { email, password } })).status() === 201);
  const csrf = (await (await client.get("/api/auth/csrf")).json()).csrfToken;
  const login = await client.post("/api/auth/callback/credentials", { form: { email, password, csrfToken: csrf, callbackUrl: base + "/projects" }, headers: { "X-Auth-Return-Redirect": "1" } });
  check("正式 Credentials 登录建立 session", login.ok() && (await session(client))?.user?.email === email);
  const signout = await client.post("/api/auth/signout", { form: { csrfToken: csrf, callbackUrl: base + "/" }, headers: { "X-Auth-Return-Redirect": "1" } });
  observations.push({ path: "serial-http-signout", status: signout.status(), setCookie: safeCookies(signout.headersArray()) });
  check("串行 HTTP 退出返回成功", signout.ok());
  check("退出响应只清除会话 Cookie，不同时续期", onlyClearsSession(signout.headersArray()));
  check("串行 HTTP 退出后 session 为空", !(await session(client))?.user);
  check("退出后受保护 API 返回 401", (await client.get("/api/projects")).status() === 401);
  await client.dispose();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(20_000); page.setDefaultNavigationTimeout(120_000);
    const browserEmail = "verify-signout-ui-" + randomUUID() + "@test.local";
    await page.goto(base + "/register");
    await page.fill("#email", browserEmail);
    await page.locator('input[type="password"]').nth(0).fill(password);
    await page.locator('input[type="password"]').nth(1).fill(password);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(url => url.pathname === "/projects");
    check(width + "px 注册进入项目页", (await session(page.request))?.user?.email === browserEmail);
    await page.goto(base + "/profile");
    page.on("response", async r => { if (new URL(r.url()).pathname.startsWith("/api/auth/")) observations.push({ path: width + "px-" + new URL(r.url()).pathname, time: Date.now(), setCookie: safeCookies(await r.headersArray()) }); });
    const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/signout" && r.request().method() === "POST");
    await page.getByRole("button", { name: /退出登录/ }).click();
    const response = await responsePromise;
    check(width + "px 退出响应只清除会话 Cookie", onlyClearsSession(await response.headersArray()));
    observations.push({ path: width + "px-browser-signout", status: response.status(), setCookie: safeCookies(await response.headersArray()) });
    await page.waitForURL(url => url.pathname === "/");
    check(width + "px 点击退出后 session 为空", !(await session(page.request))?.user);
    await page.goto(base + "/login");
    const onLogin = new URL(page.url()).pathname === "/login";
    check(width + "px 退出后登录页可访问", onLogin);
    if (onLogin) {
      await page.fill("#email", browserEmail); await page.fill("#password", password);
      await page.locator('form button[type="submit"]').click();
      await page.waitForURL(url => url.pathname === "/projects");
      check(width + "px 原账号可重新登录", (await session(page.request))?.user?.email === browserEmail);
      if (width === 1440) {
        let releaseReads;
        const release = new Promise(resolve => { releaseReads = resolve; });
        let readyCount = 0; let readsReady;
        const ready = new Promise(resolve => { readsReady = resolve; });
        await page.route("**/*verify-late=1", async route => {
          const delayed = await route.fetch();
          const writes = delayed.headersArray().filter(h => h.name.toLowerCase() === "set-cookie" && /authjs\.session-token(?:\.\d+)?=[^;]/.test(h.value));
          check("退出前的 " + new URL(route.request().url()).pathname + " 响应不续期", writes.length === 0);
          readyCount++; if (readyCount === 2) readsReady();
          await release;
          await route.fulfill({ response: delayed });
        });
        await page.evaluate(() => { window.__verifyLateReads = Promise.all([fetch("/api/auth/session?verify-late=1"), fetch("/api/projects?verify-late=1")].map(r => r.then(v => v.text()))); });
        const timeout = setTimeout(() => { readsReady(); }, 20_000);
        await ready; clearTimeout(timeout);
        check("已扣住 session 与受保护 API 两条真实响应", readyCount === 2);
        try {
          const status = await page.evaluate(async () => {
            const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
            return (await fetch("/api/auth/signout", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" }, body: new URLSearchParams({ csrfToken, callbackUrl: location.origin + "/" }) })).status;
          });
          check("在途请求未释放时退出成功", status === 200);
        } finally { releaseReads(); }
        await page.evaluate(() => window.__verifyLateReads);
        check("释放迟到响应后 session 仍为空", !(await session(page.request))?.user);
        check("释放迟到响应后受保护 API 仍为 401", (await page.request.get(base + "/api/projects")).status() === 401);
        await page.goto(base + "/login");
        check("释放迟到响应后登录页仍可访问", new URL(page.url()).pathname === "/login");
      }

    }
    await context.close();
  }
  workflows.push("auth-signout-http-and-browser");
} catch (error) { fail++; console.error("❌ " + safeError(error)); }
finally {
  await browser?.close();
  await writeFile(join(output, "auth-cookie-observations.json"), JSON.stringify(observations, null, 2));
  await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, aiMode: "replay", workflows }, null, 2));
  console.log("结果: " + pass + " 通过, " + fail + " 失败");
}
process.exit(fail > 0 ? 1 : 0);
