// v1.44：只用正式 HTTP；不查数据库、不调用认证内部函数、不记录凭据或验证码。
import { request } from "playwright-core";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";

const sameWindow = (first, last) => Math.floor(first / 900_000) === Math.floor(last / 900_000);
const loginBlocked = result => result.attempts === 20 && result.rejected === 20 && result.callbackError === "CredentialsSignin" && result.sessionStatus === 200 && !result.hasUser && result.projectStatus === 401 && result.sameWindow;
const exactBatch = results => results.length === 21 && results.filter(r => r.status === 400).length === 20 && results.filter(r => r.status === 429).length === 1 && results.every(r => r.clean && r.envelope && (r.status !== 429 || (Number.isInteger(r.retry) && r.retry > 0 && r.retry === r.retryAfter)));

// 静态红逻辑只检验断言辨别力，不作为真实 HTTP 通过数，也不回滚产品。
if (process.argv.includes("--self-test")) {
  const denied = { attempts: 20, rejected: 20, callbackError: "CredentialsSignin", sessionStatus: 200, hasUser: false, projectStatus: 401, sameWindow: true };
  assert.equal(loginBlocked(denied), true);
  assert.equal(loginBlocked({ ...denied, callbackError: null, hasUser: true, projectStatus: 200 }), false);
  assert.equal(loginBlocked({ ...denied, sameWindow: false }), false);
  const bad = { status: 400, clean: true, envelope: true };
  const limited = { status: 429, clean: true, envelope: true, retry: 60, retryAfter: 60 };
  assert.equal(exactBatch([...Array.from({ length: 20 }, () => bad), limited]), true);
  assert.equal(exactBatch(Array.from({ length: 21 }, () => limited)), false);
  assert.equal(exactBatch(Array.from({ length: 21 }, () => bad)), false);
  console.log("静态断言自检：6 通过；可识别变体绕过、并发全拒绝和漏限流；不计 HTTP 通过数。");
  process.exit(0);
}

const base = process.env.BASE_URL;
const output = process.env.V141_REPLAY_OUTPUT_DIR;
const email = process.env.V144_LEGACY_EMAIL;
const password = process.env.V144_LEGACY_PASSWORD;
const wrongPassword = randomBytes(24).toString("hex");
const registrationPassword = randomBytes(24).toString("hex");
const secrets = new Set([password, wrongPassword, registrationPassword, process.env.AUTH_SECRET, process.env.V144_EMAIL_TEST_TOKEN].filter(Boolean));
const observations = [], workflows = [];
const started = Date.now();
let pass = 0, fail = 0, client;
const budget = { login: 0, verify: 0, send: 0 };
function check(name, okay, details = {}) {
  observations.push({ name, passed: Boolean(okay), ...details });
  if (okay) { pass++; console.log("✅ " + name); }
  else { fail++; console.error("❌ " + name); }
  return Boolean(okay);
}
function need(name, okay, details) {
  if (!check(name, okay, details)) { const error = new Error("前置条件失败"); error.counted = true; throw error; }
}
function safe(error) {
  let text = String(error?.message ?? error).split("\n")[0];
  for (const secret of secrets) text = text.replaceAll(secret, "<已隐藏>");
  return text.replace(/\b\d{6}\b/g, "<已隐藏>").replace(/(password|authorization|cookie|csrfToken)\s*[:=].*/gi, "$1=<已隐藏>");
}
async function group(name, run) {
  const before = fail;
  try { await run(); } catch (error) { if (!error.counted) check(name + "中断：" + safe(error), false); }
  if (fail === before) workflows.push(name);
}
async function session() {
  const response = await client.get("/api/auth/session");
  return { status: response.status(), data: await response.json() };
}
async function login(address, submittedPassword) {
  const csrfResponse = await client.get("/api/auth/csrf");
  need("正式登录接口提供 CSRF 防护", csrfResponse.status() === 200);
  const csrf = (await csrfResponse.json()).csrfToken;
  need("CSRF 令牌有效且只留内存", typeof csrf === "string" && csrf.length > 0);
  secrets.add(csrf);
  budget.login++;
  const response = await client.post("/api/auth/callback/credentials", {
    form: { email: address, password: submittedPassword, csrfToken: csrf, callbackUrl: base + "/projects" },
    headers: { "X-Auth-Return-Redirect": "1", origin: new URL(base).origin },
    maxRedirects: 0,
  });
  let body;
  try { body = await response.json(); } catch { body = {}; }
  let error = null;
  try { error = new URL(body.url, base).searchParams.get("error"); } catch { /* 无错误地址由最终断言拒绝。 */ }
  return { status: response.status(), error };
}
async function validate(address) {
  budget.verify++;
  const response = await client.post("/api/auth/register", { data: { email: address, password: registrationPassword, code: "000000" }, headers: { origin: new URL(base).origin } });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  return {
    status: response.status(),
    clean: ![...secrets].some(secret => text.includes(secret)) && !/\b\d{6}\b/.test(text) && !/"(?:code|password|password_hash|csrfToken|stack)"\s*:/i.test(text),
    envelope: /application\/json/i.test(response.headers()["content-type"] ?? "") && typeof body?.error === "string" && body.error.trim().length > 0,
    retry: Number(response.headers()["retry-after"]), retryAfter: body?.retryAfter,
  };
}
try {
  need("仅在随机隔离库 replay 与完整旧账号夹具下执行", Boolean(base && output && process.env.AI_MODE === "replay" && /^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE ?? "") && email && password && process.env.V144_LEGACY_PROJECT_ID));
  need("旧账号 fixture 使用超过 72 字节的既有密码", Buffer.byteLength(password, "utf8") > 72);
  client = await request.newContext({ baseURL: base, timeout: 45_000 });
  need("攻击前同一 HTTP 客户端 session 为空", !(await session()).data?.user);
  // 固定窗口边缘不能当作产品回归；最多等 90 秒后开始一组完整观察。
  const remaining = 900_000 - Date.now() % 900_000;
  if (remaining < 90_000) {
    console.log("等待固定窗口边界结束后验证，避免跨窗口误判。");
    await new Promise(resolve => setTimeout(resolve, remaining + 250));
  }
  await group("login-user-accent-shared-limit", async () => {
    const variant = email.replace("@test.local", "@tést.local");
    need("旧夹具可构造不同重音域名", variant !== email);
    const first = Date.now();
    let rejected = 0;
    for (let index = 0; index < 20; index++) {
      const result = await login(index % 2 ? variant : email, wrongPassword);
      const state = await session();
      if (check("第 " + (index + 1) + " 次交替邮箱错误登录保持原会话为空", result.error === "CredentialsSignin" && state.status === 200 && !state.data?.user, { callbackStatus: result.status })) rejected++;
    }
    const result = await login(email, password);
    const state = await session();
    const projects = await client.get("/api/projects");
    const details = { attempts: 20, rejected, callbackError: result.error, sessionStatus: state.status, hasUser: Boolean(state.data?.user), projectStatus: projects.status(), sameWindow: sameWindow(first, Date.now()) };
    check("原邮箱与重音变体共用用户桶，第 21 次正确密码也被拒绝", loginBlocked(details), details);
    check("拒绝登录后同一客户端没有 session 且受保护 API 为 401", state.status === 200 && !state.data?.user && projects.status() === 401);
    check("登录额度观察未跨十五分钟固定窗口", details.sameWindow);
  });
  await group("verify-email-concurrent-exact-limit", async () => {
    for (let index = 1; index <= 2; index++) {
      const address = "limits-" + randomUUID() + "@test.local";
      const first = Date.now();
      // 同时发起 21 个正式注册验证，无发码、无挑战，不消耗 send 额度。
      const results = await Promise.all(Array.from({ length: 21 }, () => validate(address)));
      const counts = { requests: results.length, rejected400: results.filter(r => r.status === 400).length, limited429: results.filter(r => r.status === 429).length, other: results.filter(r => ![400, 429].includes(r.status)).length };
      check("并发组 " + index + " 恰好 20 个 400、1 个 429，额度内不误拒", exactBatch(results), counts);
      check("并发组 " + index + " 所有响应均为脱敏 JSON 错误", results.every(r => r.clean && r.envelope));
      check("并发组 " + index + " 未跨十五分钟固定窗口", sameWindow(first, Date.now()));
    }
    check("两组验证总计 42 次，未超过共享 IP 60 次额度", budget.verify === 42 && budget.send === 0, { ...budget });
  });
} catch (error) {
  if (!error.counted) check("限流专项异常：" + safe(error), false);
} finally {
  await client?.dispose();
  const summary = { pass, fail, aiMode: "replay", workflows, durationMs: Date.now() - started, budget, evidence: "仅真实 HTTP；随机隔离旧账号夹具；不读验证码或限流数据库；无真实模型请求" };
  if (output) {
    await writeFile(join(output, "auth-limits-observations.json"), JSON.stringify(observations, null, 2));
    await writeFile(join(output, "scenario-summary.json"), JSON.stringify(summary, null, 2));
  }
  console.log("结果: " + pass + " 通过, " + fail + " 失败");
}
process.exit(fail > 0 ? 1 : 0);