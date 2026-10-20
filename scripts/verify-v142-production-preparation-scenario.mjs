// 隔离正式应用中验证注册门禁；直接调用真实 MySQL 事务验证预算和启动恢复。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";
import { getMysqlAppConfig, getMysqlConnectionOptions } from "../src/lib/mysql-config.ts";
import { AIQuotaError, reserveAIRequest } from "../src/lib/mysql-ai-budget.ts";
import { checkProductionDatabase, recoverProductionGenerations } from "../src/lib/mysql-production-recovery.ts";
import { productionConfigurationErrors } from "../src/lib/production-config.ts";
import { createAICompletion } from "../src/lib/ai.ts";
import { verifyProductionPolish, verifyProductionLegacy } from "./verify-v142-production-preparation-polish.mjs";

let pass = 0;
let fail = 0;
const workflows = [];
function check(name, okay) {
  if (okay) { pass++; console.log(`✅ ${name}`); }
  else { fail++; const error = new Error(name); error.counted = true; throw error; }
}
const base = process.env.BASE_URL;
const output = process.env.V141_REPLAY_OUTPUT_DIR;
if (!base || !output || process.env.AI_MODE !== "replay" || !/^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE ?? "")) throw new Error("只允许隔离 replay 库");
const connectionOptions = { ...getMysqlConnectionOptions(getMysqlAppConfig()), connectionLimit: 12, dateStrings: true };
let pool = mysql.createPool(connectionOptions);
let browser;
const rows = async (sql, args = []) => (await pool.query(sql, args))[0];
const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
try {
  const health = await fetch(`${base}/api/health`);
  check("健康接口无需登录、返回 200、仅公开状态并禁止缓存", health.status === 200 && JSON.stringify(await health.json()) === '{"status":"ok"}' && health.headers.get("Cache-Control") === "no-store");
  workflows.push("public-health");

  const email = `invite-${randomUUID()}@test.local`;
  for (const inviteCode of [undefined, "wrong-code"]) {
    const response = await fetch(`${base}/api/auth/register`, json({ email, password: "verify-pass-1234", inviteCode }));
    check(`${inviteCode ? "错误" : "缺少"}邀请码在服务端返回 403 且未创建账号`, response.status === 403 && (await rows("SELECT id FROM users WHERE email = ?", [email])).length === 0);
  }
  await assertPlaywrightAvailable(chromium, { channel: "msedge" });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(45_000);
  page.setDefaultNavigationTimeout(45_000);
  await page.goto(`${base}/register`);
  check("邀请模式注册页面显示邀请码控件", await page.locator("#inviteCode").isVisible());
  await page.fill("#email", email);
  await page.fill("#password", "verify-pass-1234");
  await page.fill("#confirmPassword", "verify-pass-1234");
  await page.fill("#inviteCode", process.env.REGISTRATION_INVITE_CODE);
  check("桌面注册表单邀请码可见且无横向溢出", await page.locator("#inviteCode").isVisible() && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(output, "invited-registration-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  check("390px 注册表单邀请码可见且无横向溢出", await page.locator("#inviteCode").isVisible() && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(output, "invited-registration-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
  const session = await (await page.request.get(`${base}/api/auth/session`)).json();
  const userId = session.user?.id;
  check("正确邀请码通过真实 UI 注册并自动登录", Boolean(userId) && (await rows("SELECT id FROM users WHERE email = ?", [email]))[0]?.id === userId);
  workflows.push("invitation-register-login");

  const validEnv = {
    NODE_ENV: "production", MYSQL_HOST: "127.0.0.1", MYSQL_PORT: "3306", MYSQL_DATABASE: "isolated_fixture", MYSQL_USER: "isolated_app",
    MYSQL_PASSWORD: randomBytes(24).toString("hex"), AUTH_SECRET: randomBytes(32).toString("hex"), MYSQL_REQUIRED_VERSION: "9.7",
    AUTH_URL: "https://ideastage.top", AUTH_TRUST_HOST: "true", AI_MODE: "replay", REGISTRATION_MODE: "invite", REGISTRATION_INVITE_CODE: randomBytes(24).toString("hex"),
  };
  check("完整生产配置可离线通过预检", productionConfigurationErrors(validEnv).length === 0);
  for (const patch of [{ MYSQL_USER: "root" }, { MYSQL_REQUIRED_VERSION: "8.4" }, { AUTH_URL: "http://ideastage.top" }, { AUTH_SECRET: "short" }, { AI_MODE: "live" }, { REGISTRATION_INVITE_CODE: "short" }, { AI_DAILY_USER_LIMIT: "0" }, { MYSQL_ADMIN_PASSWORD: "maintenance-secret" }]) {
    const errors = productionConfigurationErrors({ ...validEnv, ...patch });
    check(`拒绝非法生产配置 ${Object.keys(patch)[0]} 且不泄露秘密`, errors.length > 0 && !errors.join(" ").includes(validEnv.MYSQL_PASSWORD) && !errors.join(" ").includes("maintenance-secret"));
  }
  workflows.push("offline-production-configuration");

  const day = new Date("2026-10-17T16:00:01Z");
  const limits = { AI_DAILY_SITE_LIMIT: "100", AI_DAILY_USER_LIMIT: "3" };
  const concurrent = await Promise.allSettled(Array.from({ length: 20 }, () => reserveAIRequest(userId, limits, pool, day)));
  check("20 个并发请求严格只允许账号上限 3 次，其余均为额度错误", concurrent.filter((x) => x.status === "fulfilled").length === 3 && concurrent.filter((x) => x.status === "rejected").every((x) => x.reason instanceof AIQuotaError));
  let usage = await rows("SELECT subject, request_count FROM ai_daily_usage WHERE usage_day = '2026-10-18'");
  check("账号超限时站点占用回滚，两者均恰好为 3", usage.length === 2 && usage.every((x) => x.request_count === 3));
  await pool.end();
  pool = mysql.createPool(connectionOptions);
  let restartDenied = false;
  try { await reserveAIRequest(userId, limits, pool, day); } catch (error) { restartDenied = error instanceof AIQuotaError; }
  check("连接池重建后仍保留账号限额", restartDenied);
  const otherUser = randomUUID();
  const siteResults = await Promise.allSettled(Array.from({ length: 16 }, (_, index) => reserveAIRequest(index % 2 ? otherUser : userId, { AI_DAILY_SITE_LIMIT: "5", AI_DAILY_USER_LIMIT: "100" }, pool, day)));
  usage = await rows("SELECT subject, request_count FROM ai_daily_usage WHERE usage_day = '2026-10-18'");
  check("跨账号并发严格遵守站点剩余额度 2 次", siteResults.filter((x) => x.status === "fulfilled").length === 2 && usage.find((x) => x.subject === "site")?.request_count === 5);
  check("站点额度拒绝后账号计数总量没有增长", usage.filter((x) => x.subject !== "site").reduce((sum, x) => sum + x.request_count, 0) === 5);
  await reserveAIRequest(userId, limits, pool, new Date("2026-10-17T15:59:59Z"));
  check("北京时间零点前后的计数进入两个独立日期", (await rows("SELECT usage_day, request_count FROM ai_daily_usage WHERE subject = ? ORDER BY usage_day", [userId])).map((x) => x.usage_day).join(",") === "2026-10-17,2026-10-18");
  let identityDenied = false;
  try { await reserveAIRequest(undefined, limits, pool, day); } catch (error) { identityDenied = error instanceof AIQuotaError; }
  check("缺少有效账号时供应商请求占用被拒绝", identityDenied);
  const beforeReplay = JSON.stringify(await rows("SELECT * FROM ai_daily_usage ORDER BY usage_day, subject"));
  await createAICompletion({ messages: [{ role: "user", content: "离线验证" }], maxTokens: 20, timeoutMs: 1000 });
  check("固定 replay 无需真实账号且不占用供应商额度", beforeReplay === JSON.stringify(await rows("SELECT * FROM ai_daily_usage ORDER BY usage_day, subject")));
  workflows.push("atomic-persistent-ai-budget");

  await verifyProductionPolish({ page, pool, userId, base, output, check });
  workflows.push("polish-stream-preview-boundary");
  await verifyProductionLegacy({ page, pool, userId, base, check });
  workflows.push("legacy-stream-heartbeat-cancellation");

  await checkProductionDatabase(pool);
  check("已初始化版本与全部迁移校验通过启动检查", true);
  const [migration] = await rows("SELECT id, checksum FROM schema_migrations ORDER BY id DESC LIMIT 1");
  await pool.execute("UPDATE schema_migrations SET checksum = ? WHERE id = ?", ["0".repeat(64), migration.id]);
  let invalidMigration = false;
  try { await checkProductionDatabase(pool); } catch { invalidMigration = true; }
  finally { await pool.execute("UPDATE schema_migrations SET checksum = ? WHERE id = ?", [migration.checksum, migration.id]); }
  check("迁移校验被篡改时禁止启动", invalidMigration);
  const projectId = randomUUID(); const iterationId = randomUUID(); const sessionId = randomUUID();
  const recordId = randomUUID(); const tabId = randomUUID();
  await pool.execute("INSERT INTO projects (id,user_id,name) VALUES (?,?,'恢复夹具')", [projectId, userId]);
  await pool.execute("INSERT INTO product_iterations (id,project_id,iteration_number,display_name) VALUES (?,?,1,'恢复夹具')", [iterationId, projectId]);
  await pool.execute("INSERT INTO iteration_sessions (id,iteration_id,stage) VALUES (?,?,'requirements')", [sessionId, iterationId]);
  const generatingId = randomUUID(); const completedId = randomUUID();
  await pool.execute("INSERT INTO iteration_session_messages (id,session_id,role,content,status) VALUES (?,?,'assistant','保留部分正文','generating'), (?,?,'assistant','成功正文','completed')", [generatingId, sessionId, completedId, sessionId]);
  await pool.execute("INSERT INTO iteration_file_candidates (id,message_id,session_id,suggested_filename,content) VALUES (?,?,?,'需求分析.md','候选正文')", [randomUUID(), completedId, sessionId]);
  await pool.execute("INSERT INTO prototype_snapshots (id,project_id,iteration_id,session_id,message_id,content,version) VALUES (?,?,?,?,?,'<html>快照正文</html>',1)", [randomUUID(), projectId, iterationId, sessionId, completedId]);
  await pool.execute("INSERT INTO work_records (id,project_id) VALUES (?,?)", [recordId, projectId]);
  await pool.execute("INSERT INTO tabs (id,work_record_id,agent_type,display_name,position,version,active_operation_id,freeze_status) VALUES (?,?,'requirement_analyst','恢复夹具',1,1,'recovery-request','generating')", [tabId, recordId]);
  await pool.execute("INSERT INTO tab_operations (id,tab_id,request_id,operation,expected_version,locked_version,status) VALUES (?,?,'recovery-request','send-message',0,1,'processing')", [randomUUID(), tabId]);
  await pool.execute("INSERT INTO messages (id,tab_id,role,content,timestamp,status) VALUES (?,?,'assistant','旧版部分正文',NOW(3),'generating'), (?,?,'assistant','旧版成功正文',NOW(3),'completed')", [randomUUID(), tabId, randomUUID(), tabId]);
  const retainedTables = ["iteration_file_candidates", "prototype_snapshots"];
  const retained = await Promise.all(retainedTables.map(async (table) => JSON.stringify(await rows(`SELECT * FROM ${table} ORDER BY id`))));
  const recovered = await recoverProductionGenerations(pool);
  const message = (await rows("SELECT status,content,error_message FROM iteration_session_messages WHERE id = ?", [generatingId]))[0];
  check("启动恢复将新工作台 generating 置 failed 并保留正文和重试说明", recovered.iteration === 1 && message.status === "failed" && message.content === "保留部分正文" && message.error_message.includes("重启"));
  const legacy = await rows("SELECT status,content FROM messages WHERE tab_id = ? ORDER BY status", [tabId]);
  check("启动恢复仅中断旧版生成回复并保留已成功正文", recovered.legacy === 1 && legacy.some((x) => x.status === "interrupted" && x.content === "旧版部分正文") && legacy.some((x) => x.status === "completed" && x.content === "旧版成功正文"));
  check("新工作台已成功回复逐字保留", (await rows("SELECT content,status FROM iteration_session_messages WHERE id = ?", [completedId]))[0].content === "成功正文" && (await rows("SELECT status FROM iteration_session_messages WHERE id = ?", [completedId]))[0].status === "completed");
  const tab = (await rows("SELECT active_operation_id,freeze_status,version FROM tabs WHERE id = ?", [tabId]))[0];
  const operation = (await rows("SELECT status,tab_version FROM tab_operations WHERE tab_id = ?", [tabId]))[0];
  check("恢复释放旧版操作锁、冻结状态与版本一致收口", tab.active_operation_id === null && tab.freeze_status === "failed" && tab.version === 2 && operation.status === "failed" && operation.tab_version === 2);
  check("恢复不改变候选和 HTML 快照", (await Promise.all(retainedTables.map(async (table) => JSON.stringify(await rows(`SELECT * FROM ${table} ORDER BY id`))))).every((value, index) => value === retained[index]));
  const allBefore = JSON.stringify(await Promise.all(["tabs", "tab_operations", "messages", "iteration_session_messages"].map((table) => rows(`SELECT * FROM ${table} ORDER BY id`))));
  const repeated = await recoverProductionGenerations(pool);
  check("重复启动恢复幂等且不二次推进版本", repeated.iteration === 0 && repeated.legacy === 0 && allBefore === JSON.stringify(await Promise.all(["tabs", "tab_operations", "messages", "iteration_session_messages"].map((table) => rows(`SELECT * FROM ${table} ORDER BY id`)))));
  workflows.push("startup-recovery-idempotency");
} catch (error) {
  if (!error.counted) fail++;
  console.error(`❌ 专项未完成：${error.stack ?? error}`);
} finally {
  if (browser) await browser.close();
  await pool.end();
  await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, aiMode: "replay", workflows }, null, 2));
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
