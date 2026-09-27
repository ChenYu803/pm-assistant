// v1.41 #05：项目级文件树、预览下载和项目隔离的确定性回放。
import { chromium } from "playwright-core";
import nextEnv from "@next/env";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.AI_MODE !== "replay") {
  console.error("❌ 本验证要求 AI_MODE=replay");
  process.exit(1);
}

const base = process.env.BASE_URL || "http://localhost:3000";
let pass = 0;
let fail = 0;
function check(name, okay) {
  if (okay) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.error(`❌ ${name}`); }
}

async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init);
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body };
  }, { path, init });
}

async function register(page, email) {
  await page.goto(`${base}/register`);
  await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
}

await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await owner.newPage();
  await register(page, `verify-file-tree-${Date.now()}@test.local`);
  const project = await api(page, "/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "文件树验证项目" }) });
  const projectId = project.body.id;
  await page.goto(`${base}/projects`);
  await page.getByRole("button", { name: "文件树验证项目", exact: true }).click();
  await page.getByRole("heading", { name: "项目文件树" }).waitFor();
  await page.locator(".iteration-project-files .project-tree-branch").first().waitFor();
  check("没有产品迭代时仍显示四个固定树枝", await page.locator(".iteration-project-files .project-tree-branch").count() === 4);
  check("无当前迭代的文件树没有上下文和修改入口", await page.locator(".iteration-project-files .project-tree-context-action, .iteration-project-files [aria-label*='编辑'], .iteration-project-files [aria-label*='删除']").count() === 0);

  const created = await api(page, `/api/projects/${projectId}/files`, { method: "POST", headers: { "Content-Type": "application/json", "x-pm-assistant-test-system-write": "1" }, body: JSON.stringify({ filename: "原型.md", content: "# 原型正文\n\n当前内容。", agent_type: "prototype" }) });
  check("测试文件写入成功", created.status === 201);
  const fileId = created.body.id;
  const issue = await api(page, `/api/projects/${projectId}/files`, { method: "POST", headers: { "Content-Type": "application/json", "x-pm-assistant-test-system-write": "1" }, body: JSON.stringify({ filename: "issues/01-项目文件树.md", content: "**What to build:** 展示项目文件树。\n\n**Blocked by:** 无\n\n**验收标准:** 可打开文件。", agent_type: "ticket_splitter" }) });
  check("任务文件可进入项目树", issue.status === 201);
  const working = await api(page, `/api/projects/${projectId}/files`, { method: "POST", headers: { "Content-Type": "application/json", "x-pm-assistant-test-system-write": "1" }, body: JSON.stringify({ filename: "需求分析-工作文档（验证）.md", content: "过程记录", agent_type: "requirement_analyst" }) });
  check("过程文档夹具写入成功", working.status === 201);
  const list = await api(page, `/api/projects/${projectId}/files`);
  check("目录返回项目文件及修订号", list.status === 200 && list.body.some((file) => file.id === fileId && file.version === 1));
  check("过程文档不进入项目文件树", !list.body.some((file) => file.id === working.body.id));
  check("无迭代时旧接口拒绝编辑和删除", (await api(page, `/api/projects/${projectId}/files/${fileId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "越权修改" }) })).status === 409 && (await api(page, `/api/projects/${projectId}/files/${fileId}`, { method: "DELETE" })).status === 409);
  await page.getByRole("button", { name: "刷新" }).click();
  await page.getByText("未归属任务", { exact: true }).waitFor();
  check("任务拆分树枝包含任务文件夹和 issue", await page.locator(".iteration-project-files .project-tree-folder").count() === 1 && await page.locator(".iteration-project-files .project-tree-folder .project-tree-name").filter({ hasText: "01-项目文件树.md" }).count() === 1);
  await page.screenshot({ path: ".impeccable/review/project-file-tree-desktop.png", fullPage: true });
  await page.locator(".iteration-project-files .project-tree-name").filter({ hasText: "原型.md" }).click();
  await page.getByRole("dialog", { name: "预览 原型.md" }).waitFor();
  await page.getByRole("dialog", { name: "预览 原型.md" }).getByText("原型正文").waitFor();
  check("无当前迭代可打开 Markdown 预览", await page.getByRole("dialog", { name: "预览 原型.md" }).getByText("原型正文").count() === 1);
  const detail = await api(page, `/api/projects/${projectId}/files/${fileId}`);
  const download = await api(page, `/api/projects/${projectId}/files/${fileId}/download`);
  check("预览与下载正文一致且不含 changelog", detail.body.content === download.body && !download.body.includes("changelog:"));
  const whitespace = await api(page, `/api/projects/${projectId}/files`, { method: "POST", headers: { "Content-Type": "application/json", "x-pm-assistant-test-system-write": "1" }, body: JSON.stringify({ filename: "prd.md", content: "  缩进正文\n", agent_type: "mvp_prd" }) });
  const whitespaceDownload = await api(page, `/api/projects/${projectId}/files/${whitespace.body.id}/download`);
  check("下载保留正文开头的空白", whitespace.status === 201 && whitespaceDownload.body === "  缩进正文\n");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/project-file-preview-mobile.png", fullPage: true });
  check("390px 预览没有横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole("button", { name: "关闭预览" }).press("Shift+Tab");
  check("预览的键盘焦点留在弹层", await page.evaluate(() => document.activeElement?.tagName === "A"));
  await page.setViewportSize({ width: 1440, height: 900 });
  const otherProject = await api(page, "/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "另一项目" }) });
  check("同一用户跨项目文件 ID 不能读取正文或下载", (await api(page, `/api/projects/${otherProject.body.id}/files/${fileId}`)).status === 404 && (await api(page, `/api/projects/${otherProject.body.id}/files/${fileId}/download`)).status === 404);
  await page.getByRole("button", { name: "关闭预览" }).click();
  let failOnce = true;
  await page.route(`**/api/projects/${projectId}/files/${fileId}`, async (route) => {
    if (failOnce) { failOnce = false; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "暂时失败" }) }); }
    else await route.continue();
  });
  await page.locator(".iteration-project-files .project-tree-name").filter({ hasText: "原型.md" }).click();
  await page.getByRole("alert").filter({ hasText: "暂时失败" }).waitFor();
  await page.getByRole("button", { name: "重试" }).click();
  await page.getByRole("dialog", { name: "预览 原型.md" }).getByText("原型正文").waitFor();
  check("文件详情失败后重试可恢复", !failOnce);
  await page.getByRole("button", { name: "关闭预览" }).click();
  await page.unroute(`**/api/projects/${projectId}/files/${fileId}`);

  const first = await api(page, `/api/projects/${projectId}/iterations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "第一轮", goal: "验证共享目录" }) });
  const second = await api(page, `/api/projects/${projectId}/iterations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "第二轮", goal: "验证共享目录" }) });
  check("未选当前迭代仍拒绝文件修改", (await api(page, `/api/projects/${projectId}/files/${fileId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "越权修改" }) })).status === 409);
  for (const iteration of [first.body, second.body]) {
    await page.goto(`${base}/projects/${projectId}/iterations/${iteration.id}`);
    await page.locator(".workbench-grid").waitFor();
    if (await page.getByRole("button", { name: "展开文件区" }).count()) await page.getByRole("button", { name: "展开文件区" }).click();
    check(`${iteration.display_name}看到同一项目文件`, await page.locator(".workbench-context .project-tree-name").filter({ hasText: "原型.md" }).count() === 1);
  }

  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await register(strangerPage, `verify-file-tree-other-${Date.now()}@test.local`);
  check("其他用户不能读取项目目录", (await api(strangerPage, `/api/projects/${projectId}/files`)).status === 404);
  check("其他用户不能读取正文或下载", (await api(strangerPage, `/api/projects/${projectId}/files/${fileId}`)).status === 404 && (await api(strangerPage, `/api/projects/${projectId}/files/${fileId}/download`)).status === 404);
  await stranger.close();
  await owner.close();
} finally {
  await browser.close();
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
