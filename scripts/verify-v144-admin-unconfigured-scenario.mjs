import { request } from "playwright-core";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requestRegistrationCode } from "./verify-email-fixture.mjs";
let pass = 0, fail = 0;
function check(name, okay) { console.log((okay ? "✅ " : "❌ ") + name); okay ? pass++ : fail++; }
let http;
try {
  if (!/^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE ?? "") || process.env.ADMIN_EMAILS) throw Error("必须在未配置管理员的隔离环境运行");
  http = await request.newContext({ baseURL: process.env.BASE_URL, timeout: 120_000 });
  const email = "admin-" + randomUUID() + "@test.local", password = "admin-unconfigured-123";
  check("名字包含 admin 的账号仍正常注册", (await http.post("/api/auth/register", { data: { email, password, code: await requestRegistrationCode(http, email) } })).status() === 201);
  const csrfToken = (await (await http.get("/api/auth/csrf")).json()).csrfToken;
  await http.post("/api/auth/callback/credentials", { form: { email, password, csrfToken }, headers: { "X-Auth-Return-Redirect": "1" } });
  const user = (await (await http.get("/api/auth/session")).json())?.user;
  check("普通登录不受管理员配置影响", !!user);
  check("未配置时首个账号没有管理权限", (await http.get("/api/admin/users")).status() === 403);
  check("未配置时不能执行管理操作", (await http.post("/api/admin/users/" + user.id + "/disable", { data: { reason: "不应拥有权限" } })).status() === 403);
  const page = await http.get("/admin");
  check("未配置时后台不返回列表", (await page.text()).includes("无权访问管理后台"));
} catch (error) { check(String(error.message).split("\n")[0], false); }
finally { await http?.dispose(); await writeFile(join(process.env.V141_REPLAY_OUTPUT_DIR, "scenario-summary.json"), JSON.stringify({ pass, fail, aiMode: "replay", workflows: fail ? [] : ["admin-unconfigured-denial"] })); }
process.exit(fail > 0 ? 1 : 0);
