// v1.3 #02：账号、项目、工作记录与 tab 的 MySQL 外部流程验证。
// 只使用固定回放环境，不发起任何真实模型调用。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE = process.env.BASE_URL || "http://localhost:3000";
const email = `verify-workspace-${Date.now()}@test.local`;
const password = "verify-pass-1234";
let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? `：${detail}` : ""}`);
  }
}

function isMysqlId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

async function api(page, pathname, init) {
  return page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, requestInit);
      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
      };
    },
    { requestPath: pathname, requestInit: init }
  );
}

if (process.env.AI_MODE !== "replay") {
  console.error("❌ #02 验证要求 AI_MODE=replay，未运行");
  process.exit(1);
}

if (!process.env.MYSQL_HOST || !process.env.MYSQL_DATABASE || !process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD) {
  console.error("❌ #02 验证需要 MYSQL_HOST、MYSQL_DATABASE、MYSQL_USER 和 MYSQL_PASSWORD");
  process.exit(1);
}

await assertPlaywrightAvailable(chromium, { channel: "msedge" });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
let connection;

try {
  await page.goto(`${BASE}/register`);
  await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
  check("新用户注册后进入项目列表", page.url().endsWith("/projects"));

  const duplicate = await api(page, "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  check("邮箱唯一约束拒绝重复注册", duplicate.status === 409);

  const projectCreate = await api(page, "/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "MySQL 工作区验证" }),
  });
  const projectId = projectCreate.body?.id;
  check("创建项目返回统一 MySQL 标识符", projectCreate.status === 201 && isMysqlId(projectId));

  const projectRename = await api(page, `/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "已改名项目" }),
  });
  check("项目可以重命名", projectRename.status === 200 && projectRename.body?.name === "已改名项目");

  const workRecordCreate = await api(page, `/api/projects/${projectId}/work-records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "第一条工作记录" }),
  });
  const workRecordId = workRecordCreate.body?.id;
  check("创建工作记录保留项目关系", workRecordCreate.status === 201 && isMysqlId(workRecordId) && workRecordCreate.body?.project_id === projectId);

  const workRecordRename = await api(page, `/api/work-records/${workRecordId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "已改名工作记录" }),
  });
  check("工作记录可以重命名", workRecordRename.status === 200 && workRecordRename.body?.name === "已改名工作记录");

  const tabCreate = await api(page, `/api/work-records/${workRecordId}/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_type: "requirement_analyst" }),
  });
  const tab = tabCreate.body?.tab;
  check("创建 tab 保留工作记录关系和初始排序", tabCreate.status === 201 && isMysqlId(tab?.id) && tab?.work_record_id === workRecordId && tab?.position === 0);

  const renameRequestId = `rename-${Date.now()}`;
  const tabRename = await api(page, `/api/tabs/${tab?.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: "访谈标签页", expectedVersion: tab?.version, requestId: renameRequestId }),
  });
  check("tab 可以重命名并推进既有并发版本", tabRename.status === 200 && tabRename.body?.display_name === "访谈标签页" && tabRename.body?.version === 2);

  const tabRenameReplay = await api(page, `/api/tabs/${tab?.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: "访谈标签页", expectedVersion: tab?.version, requestId: renameRequestId }),
  });
  check("重复 tab 改名返回同一结果", tabRenameReplay.status === 200 && tabRenameReplay.body?.version === 2);

  const secondTabCreate = await api(page, `/api/work-records/${workRecordId}/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_type: "prototype" }),
  });
  const secondTab = secondTabCreate.body?.tab;
  check("tab 按创建位置稳定排序", secondTabCreate.status === 201 && secondTab?.position === 1);

  await page.goto(`${BASE}/workspace/${workRecordId}`);
  await page.getByRole("tab", { name: secondTab?.display_name }).click();
  await page.reload();
  const tabsAfterReload = await api(page, `/api/work-records/${workRecordId}/tabs`);
  const selectedTab = page.locator('[role="tab"][aria-selected="true"]');
  check(
    "刷新后恢复正确的项目、工作记录和选中 tab",
    page.url().endsWith(`/workspace/${workRecordId}`) &&
      tabsAfterReload.status === 200 &&
      tabsAfterReload.body?.map((item) => item.id).join(",") === `${tab.id},${secondTab.id}` &&
      (await selectedTab.textContent())?.includes(secondTab.display_name)
  );

  connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || "3306"),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
  });
  const [rows] = await connection.query(
    `SELECT u.email, p.id AS project_id, w.id AS work_record_id, t.id AS tab_id
     FROM users u
     JOIN projects p ON p.user_id = u.id
     JOIN work_records w ON w.project_id = p.id
     JOIN tabs t ON t.work_record_id = w.id
     WHERE u.email = ? AND p.id = ? AND w.id = ? AND t.id = ?`,
    [email, projectId, workRecordId, tab.id]
  );
  check("MySQL 可观察关系与公开标识符一致", rows.length === 1);

  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  const otherEmail = `verify-workspace-other-${Date.now()}@test.local`;
  await otherPage.goto(`${BASE}/register`);
  await otherPage.fill("#email", otherEmail);
  await otherPage.locator('input[type="password"]').first().fill(password);
  await otherPage.locator('input[type="password"]').nth(1).fill(password);
  await otherPage.locator('form button[type="submit"]').click();
  await otherPage.waitForURL((url) => url.pathname === "/projects");
  const forbidden = await api(otherPage, `/api/projects/${projectId}`);
  check("跨用户访问项目被拒绝", forbidden.status === 404);
  const forbiddenWorkRecord = await api(otherPage, `/api/work-records/${workRecordId}`);
  const forbiddenTabs = await api(otherPage, `/api/work-records/${workRecordId}/tabs`);
  const forbiddenTabRename = await api(otherPage, `/api/tabs/${tab.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: "越权改名", expectedVersion: 2, requestId: `forbidden-${Date.now()}` }),
  });
  check("跨用户访问工作记录和 tab 被拒绝", forbiddenWorkRecord.status === 404 && forbiddenTabs.status === 404 && forbiddenTabRename.status === 404);
  await otherContext.close();
} finally {
  await connection?.end();
  await context.close();
  await browser.close();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
