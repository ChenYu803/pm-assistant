// 无障碍/交互验收脚本：Radix Dialog 行为 + TabBar 重命名 + 自动增高 + 字体
// 用法: node scripts/verify-a11y.mjs
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const email = `verify-${Date.now()}@test.local`;
const password = "verify-pass-123";
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(12000);

// 注册 + 建项目 + 建工作记录（复用既有流程）
await page.goto(`${BASE}/register`);
await page.fill("#email", email);
await page.fill('input[type="password"]', password);
await page.locator('input[type="password"]').nth(1).fill(password);
await page.locator('form button[type="submit"]').click();
await page.waitForURL((u) => u.pathname === "/projects", { timeout: 20000 });
await page.getByRole("button", { name: "新建项目" }).click();
await page.fill('input[placeholder="输入项目名称"]', "验收项目");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /验收项目/ }).click();
await page.waitForURL((u) => u.pathname.startsWith("/projects/"), { timeout: 15000 });
const projectId = page.url().split("/").pop();
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await page.getByRole("button", { name: "确认创建" }).click();
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((u) => u.pathname.startsWith("/workspace/"), { timeout: 15000 });
await page.getByRole("button", { name: /需求分析/ }).first().click();
await page.waitForLoadState("networkidle");

// 1. 字体检查：body 以 Geist 开头
const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
check("字体仍为 Geist", font.startsWith("var(--font-geist-sans)") || /Geist/.test(font), font);

// 2. AgentTypeDialog：Escape 关闭
await page.getByRole("button", { name: "+", exact: true }).click();
await page.getByRole("dialog").waitFor();
const dlgAttrs = await page.getByRole("dialog").evaluate((el) => ({
  role: el.getAttribute("role"),
  ariaModal: el.getAttribute("aria-modal"),
  ariaLabelledby: el.getAttribute("aria-labelledby"),
}));
// 新版 Radix 以背景 inert + aria-labelledby 实现模态语义，无 aria-modal 属性
check("AgentTypeDialog 打开（role=dialog + aria-labelledby）",
  dlgAttrs.role === "dialog" && !!dlgAttrs.ariaLabelledby,
  JSON.stringify(dlgAttrs));
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check("Escape 关闭 AgentTypeDialog", (await page.getByRole("dialog").count()) === 0);

// 3. AgentTypeDialog：再次打开 → backdrop 点击关闭
await page.getByRole("button", { name: "+", exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.mouse.click(700, 100); // 点击弹窗外部
await page.waitForTimeout(400);
check("backdrop 点击关闭 AgentTypeDialog", (await page.getByRole("dialog").count()) === 0);

// 4. AgentTypeDialog：打开后焦点落入弹窗内
await page.getByRole("button", { name: "+", exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.waitForTimeout(300);
const focusInDialog = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  return dlg ? dlg.contains(document.activeElement) : false;
});
check("打开后焦点自动落入弹窗", focusInDialog);
await page.keyboard.press("Escape");

// 5. 文件编辑器弹窗：backdrop 点击不关闭（保持原行为）
await page.request.post(`${BASE}/api/projects/${projectId}/files`, {
  data: { filename: "需求分析.md", content: "# 测试\n\n内容", agent_type: "requirement_analyst" },
});
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByRole("button", { name: /需求分析\.md/ }).first().click();
await page.waitForTimeout(600);
// FileTree 悬浮工具栏和预览面板各有一个 title="编辑" 的按钮，取 DOM 顺序最后的预览面板那个
const editBtns = page.getByRole("button", { name: "编辑" });
console.log("   [debug] 编辑按钮数量:", await editBtns.count());
await editBtns.last().click();
await page.waitForTimeout(600);
console.log("   [debug] 点击后 dialog 数量:", await page.getByRole("dialog").count());
await page.getByRole("dialog").waitFor();
await page.mouse.click(700, 100);
await page.waitForTimeout(400);
check("FileEditorModal backdrop 点击不关闭", (await page.getByRole("dialog").count()) === 1);
// Escape 关闭
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check("Escape 关闭 FileEditorModal", (await page.getByRole("dialog").count()) === 0);

// 6. TabBar 双击重命名：双击 → 输入框出现 → Enter 提交
const tab = page.locator("div.group", { hasText: "需求分析" }).first();
await tab.dblclick();
const renameInput = page.locator("input").first();
await renameInput.waitFor();
check("双击出现重命名输入框", true);
await renameInput.fill("改名后的标签");
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
check("Enter 提交重命名", (await page.getByText("改名后的标签").count()) > 0);

// 7. ChatArea 输入框自动增高（多行输入 → 高度增长）
const textarea = page.locator("textarea").last();
const h0 = await textarea.evaluate((el) => el.offsetHeight);
await textarea.fill("第一行\n第二行\n第三行\n第四行");
await page.waitForTimeout(200);
const h1 = await textarea.evaluate((el) => el.offsetHeight);
check("输入框自动增高", h1 > h0, `${h0} → ${h1}`);

// 8. AlertDialog：删除项目确认流程（取消不删除）
await page.goto(`${BASE}/projects`);
await page.waitForLoadState("networkidle");
const deleteBtn = page.getByRole("button", { name: "删除" }).first();
await deleteBtn.click();
await page.getByRole("alertdialog").waitFor();
check("AlertDialog 打开（role=alertdialog）", true);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check("Escape 关闭 AlertDialog 且未删除",
  (await page.getByText("验收项目").count()) > 0);

// 9. AlertDialog：确认删除（项目消失）
await deleteBtn.click();
await page.getByRole("alertdialog").waitFor();
await page.getByRole("button", { name: "删除", exact: true }).click();
await page.waitForTimeout(800);
check("确认删除后项目消失", (await page.getByText("验收项目").count()) === 0);

await browser.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
