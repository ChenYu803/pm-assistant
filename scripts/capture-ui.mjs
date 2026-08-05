// UI 截图脚本：注册 → 建项目 → 建工作记录 → 工作台全状态截图
// 用法: node scripts/capture-ui.mjs <输出目录> [--skip-login]
// 驱动本机 Edge（msedge channel），无需下载浏览器。
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const OUT = process.argv[2] || ".scratch/screenshots/capture";
const email = `capture-${Date.now()}@test.local`;
const password = "capture-pass-1234";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });

// ── 注册 ──────────────────────────────────────────────────────────────
await page.goto(`${BASE}/register`);
await shot("01-register");
await page.fill("#email", email);
await page.fill('input[type="password"]', password);
await page.locator('input[type="password"]').nth(1).fill(password);
await page.locator('form button[type="submit"]').click();
await page.waitForURL((u) => u.pathname !== "/register", { timeout: 15000 });

// 若注册后未自动登录，则显式登录
if (page.url().includes("/login")) {
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
}

// ── 项目列表 ─────────────────────────────────────────────────────────
await page.goto(`${BASE}/projects`);
await page.waitForLoadState("networkidle");
await shot("02-projects-empty");
await page.getByRole("button", { name: "新建项目" }).click();
await shot("03-projects-create-form");
await page.fill('input[placeholder="输入项目名称"]', "校园二手交易平台");
await page.locator('form button[type="submit"]').click();
// 创建后停留在列表页，点击项目卡片进入项目页
await page.getByRole("link", { name: /校园二手交易平台/ }).click();
await page.waitForURL((u) => /\/projects\/[0-9a-f]{24}$/.test(u.pathname), { timeout: 15000 });
const projectId = page.url().split("/").pop();
await shot("04-workrecords-empty");
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await shot("05-workrecords-confirm");
await page.getByRole("button", { name: "确认创建" }).click();
// 创建后停留在列表页，点击工作记录卡片进入工作台
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((u) => u.pathname.startsWith("/workspace/"), { timeout: 15000 });
const workRecordId = page.url().split("/").pop();
await page.waitForLoadState("networkidle");
await shot("06-workspace-empty");

// ── 创建标签页（空态直接选 Agent）+ AgentTypeDialog（需已有标签页才有 + 按钮）──
await page.getByRole("button", { name: /需求分析/ }).first().click();
await page.waitForLoadState("networkidle");
await shot("08-workspace-chat-empty");
await page.getByRole("button", { name: "+", exact: true }).click();
await shot("07-agenttype-dialog");
await page.getByRole("button", { name: "取消" }).click();

// ── 通过 API 创建一个文件（带会话 cookie）→ FileTree/预览/编辑弹窗 ──
await page.request.post(`${BASE}/api/projects/${projectId}/files`, {
  data: {
    filename: "需求分析.md",
    content: "# 需求分析文档\n\n## 1. 校园二手交易\n\n### 用户与场景\n大学生在校园内闲置物品交易困难。\n\n### 用户故事\n作为学生，我想要发布闲置物品，以便快速卖出。\n\n### 功能范围\n发布商品、浏览、站内沟通。\n\n### 成功指标\n月发布量 1000+。",
    agent_type: "requirement_analyst",
  },
});
await page.reload();
await page.waitForLoadState("networkidle");
await shot("09-workspace-with-file");
await page.getByRole("button", { name: /需求分析\.md/ }).first().click();
await shot("10-file-preview-panel");
await page.getByRole("button", { name: "编辑" }).click();
await shot("11-file-editor-modal");

await browser.close();
console.log(`基线截图完成 → ${OUT}/ (账号: ${email})`);
