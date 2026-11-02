// 只从正式 HTTP 入口验证：缺少真实配置时不伪装成功，不产生可用账号。
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
let pass = 0, fail = 0; const assertions = [];
function check(name, okay) { assertions.push({name, okay}); console.log((okay ? "✅ " : "❌ ") + name); if (okay) pass++; else fail++; }
try {
 if (!/^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE ?? "") || process.env.V144_EMAIL_TEST_URL || process.env.RESEND_API_KEY) throw Error("必须关闭替身且清除真实邮件配置");
 const email = "unconfigured-" + randomUUID() + "@test.local";
 async function post(path, body) { return fetch(process.env.BASE_URL + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
 const sent = await post("/api/auth/email-code", { email, purpose: "register" }); const data = await sent.json();
 check("缺少邮件配置明确返回503与可操作反馈", sent.status === 503 && /尚未配置/.test(data.error) && data.retryAfter === 60);
 check("响应不携带验证码或供应商密钥", !data.code && !data.key && !/\b[0-9]{6}\b/.test(JSON.stringify(data)));
 const register = await post("/api/auth/register", { email, password: "not-created-123", code: "123456" });
 check("未发出邮件不能建立正常账号", register.status === 400 && /未发送成功/.test((await register.json()).error));
 const csrfClient = await import("playwright-core").then(m => m.request.newContext({ baseURL: process.env.BASE_URL }));
 try {
  const csrfToken = (await (await csrfClient.get("/api/auth/csrf")).json()).csrfToken;
  await csrfClient.post("/api/auth/callback/credentials", { form: { email, password: "not-created-123", csrfToken }, headers: { "X-Auth-Return-Redirect": "1" } });
  check("失败注册的邮箱不能登录", !(await (await csrfClient.get("/api/auth/session")).json())?.user);
 } finally { await csrfClient.dispose(); }
} catch (error) { fail++; console.error("❌ " + String(error.message).split("\n")[0]); }
await writeFile(join(process.env.V141_REPLAY_OUTPUT_DIR,"scenario-summary.json"), JSON.stringify({pass,fail,aiMode:"replay",workflows:fail?[]:["unconfigured"],assertions}, null,2));
process.exit(fail>0?1:0);
