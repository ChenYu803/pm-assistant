// v1.41 #01：产品迭代生命周期确定性专项验证。
// 只使用固定回放环境，不发起任何真实模型调用。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE = process.env.BASE_URL || "http://localhost:3000";
const email = `verify-v141-iteration-${Date.now()}@test.local`;
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

async function api(page, pathname, init) {
  return page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, requestInit);
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    { requestPath: pathname, requestInit: init },
  );
}

if (process.env.AI_MODE !== "replay") {
  console.error("❌ #01 验证要求 AI_MODE=replay，未运行");
  process.exit(1);
}

if (!process.env.MYSQL_HOST || !process.env.MYSQL_DATABASE || !process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD) {
  console.error("❌ #01 验证需要 MYSQL_HOST、MYSQL_DATABASE、MYSQL_USER 和 MYSQL_PASSWORD");
  process.exit(1);
}

await assertPlaywrightAvailable(chromium, { channel: "msedge" });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: Number(process.env.VIEWPORT_WIDTH || 1440), height: 1000 } });
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

  const projectCreate = await api(page, "/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "v1.41 产品迭代验证" }),
  });
  const projectId = projectCreate.body?.id;
  check("创建验证项目", projectCreate.status === 201 && typeof projectId === "string");

  await page.goto(`${BASE}/projects/${projectId}`);
  check("旧项目详情地址回到唯一项目入口", new URL(page.url()).pathname === "/projects");
  await page.getByRole("button", { name: "创建产品迭代" }).first().click();
  check("创建抽屉打开且两个目标选项默认未选", await page.locator('input[name="target-mode"]:checked').count() === 0);
  await page.getByLabel("展示名称").fill("第一轮验证");
  await page.getByText("填写本轮目标", { exact: true }).click();
  await page.getByRole("textbox", { name: /本轮目标/ }).fill("让第一次使用的人理解工作方式。");
  const firstCreate = page.getByRole("button", { name: "创建并进入工作区" });
  await firstCreate.click();
  await page.waitForURL((url) => url.pathname.includes("/iterations/"));
  check("填写目标后进入占位工作区", (await page.locator(".iteration-placeholder-content").count()) === 1 && (await page.locator("h1").textContent())?.includes("工作区已打开"));

  const firstList = await api(page, `/api/projects/${projectId}/iterations`);
  const firstIteration = firstList.body?.[0];
  check("第一条迭代返回稳定编号和目标", firstList.status === 200 && firstIteration?.iteration_number === 1 && firstIteration.goal === "让第一次使用的人理解工作方式。");

  await page.goto(`${BASE}/projects/${projectId}`);
  await page.getByRole("button", { name: "创建产品迭代" }).first().click();
  await page.getByLabel("展示名称").fill("第二轮验证");
  await page.getByText("暂不填写", { exact: true }).click();
  check("直接暂不填写弹出风险确认", await page.getByRole("heading", { name: "暂不填写本轮目标？" }).count() === 1);
  check("风险确认包含 Agent 已知/未知", await page.getByText("Agent 已知", { exact: true }).count() === 1 && await page.getByText("Agent 未知", { exact: true }).count() === 1);
  await page.getByRole("button", { name: "返回重新选择" }).click();
  const skipRadio = page.locator('input[type="radio"][value="skip"]');
  check("返回后保留跳过选择和名称草稿", await page.getByLabel("展示名称").inputValue() === "第二轮验证" && await skipRadio.count() === 1 && await skipRadio.isChecked());
  await page.getByText("暂不填写", { exact: true }).click();
  await page.getByRole("button", { name: "确认暂不填写" }).click();
  check("确认后风险层关闭", await page.getByRole("heading", { name: "暂不填写本轮目标？" }).count() === 0);
  await firstCreate.click();
  await page.waitForURL((url) => url.pathname.includes("/iterations/"));

  const listAfterSkip = await api(page, `/api/projects/${projectId}/iterations`);
  const secondIteration = listAfterSkip.body?.find((item) => item.iteration_number === 2);
  check("暂不填写创建第二条迭代且目标为空", listAfterSkip.status === 200 && secondIteration?.goal === null);
  check("刷新后稳定编号和目标保持", (await api(page, `/api/iterations/${secondIteration?.id}`)).body?.iteration_number === 2);

  await page.goto(`${BASE}/projects/${projectId}`);
  await page.locator(".iteration-row").nth(1).waitFor();
  const rows = page.locator('.iteration-table [role="listitem"]');
  await rows.first().getByRole("button", { name: "编辑迭代" }).click();
  check("编辑抽屉中的稳定编号不可编辑", await page.getByLabel("稳定编号").isDisabled());
  await page.getByLabel("展示名称").fill("第二轮验证（已命名）");
  await page.getByRole("textbox", { name: /本轮目标/ }).fill("补充一条明确目标。");
  await page.getByRole("button", { name: "保存修改" }).click();
  await page.getByRole("status").filter({ hasText: "稳定编号保持不变" }).waitFor();
  check("编辑保存成功反馈", await page.getByRole("status").filter({ hasText: "稳定编号保持不变" }).count() === 1);
  const updated = await api(page, `/api/iterations/${secondIteration?.id}`);
  check("编辑只改变名称和目标，稳定编号不变", updated.body?.display_name === "第二轮验证（已命名）" && updated.body?.goal === "补充一条明确目标。" && updated.body?.iteration_number === 2);

  connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || "3306"), database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
  const [rowsInMysql] = await connection.query(
    `SELECT iteration_number, display_name, goal FROM product_iterations WHERE project_id = ? ORDER BY iteration_number ASC`,
    [projectId],
  );
  check("MySQL 最终事实包含两条递增迭代", rowsInMysql.length === 2 && rowsInMysql[0].iteration_number === 1 && rowsInMysql[1].iteration_number === 2);
} finally {
  await connection?.end();
  await context.close();
  await browser.close();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
