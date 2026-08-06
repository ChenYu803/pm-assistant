// 验证问题 4：API key 无效（401）时弹窗提示，错误不进对话区、不显示重试
// 前置：.env.local 的 DEEPSEEK_API_KEY 已临时改坏（改坏前先备份！）
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = "http://localhost:3000";

const email = `verify4xx-${Date.now()}@test.local`;
const password = "verify-pass-1234";
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
  }
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

const shot = (name) =>
  page.screenshot({
    path: path.join(ROOT, ".scratch", "screenshots", "verify", `${name}.png`),
  });

// ── 注册 → 项目 → 工作记录 → tab ──────────────────────────────
await page.goto(`${BASE}/register`);
await page.fill("#email", email);
await page.fill('input[type="password"]', password);
await page.locator('input[type="password"]').nth(1).fill(password);
await page.locator('form button[type="submit"]').click();
await page.waitForURL((u) => u.pathname !== "/register", { timeout: 15000 });
if (page.url().includes("/login")) {
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
}

await page.goto(`${BASE}/projects`);
await page.getByRole("button", { name: "新建项目" }).click();
await page.fill('input[placeholder="输入项目名称"]', "验证错误处理");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /验证错误处理/ }).click();
await page.waitForURL((u) => /\/projects\/[0-9a-f]{24}$/.test(u.pathname));
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await page.getByRole("button", { name: "确认创建" }).click();
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((u) => u.pathname.startsWith("/workspace/"));
await page.getByRole("button", { name: /需求分析/ }).first().click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(600);

// ── 发送消息，等 401 ─────────────────────────────────────────
await page.locator("textarea").fill("你好，请介绍一下你自己");
await page.getByRole("button", { name: "发送" }).click();

// 等待弹窗或超时
let dialogVisible = false;
try {
  await page
    .locator('[role="dialog"]')
    .waitFor({ state: "visible", timeout: 20000 });
  dialogVisible = true;
} catch {
  // 弹窗没出现
}
await page.waitForTimeout(800);
await shot("03-401-dialog");

const dialogText = dialogVisible
  ? (await page.locator('[role="dialog"]').innerText()) || ""
  : "";
check("问题4: 401 时出现弹窗", dialogVisible);
check(
  "问题4: 弹窗文案说明 API key 问题",
  dialogText.includes("API Key 无效或未配置"),
  `(text=${dialogText.slice(0, 60)})`
);
check("问题4: 弹窗不含原始 401 错误堆栈", !dialogText.includes("invalid_api_key"));
check(
  "问题4: 弹窗提供关闭按钮",
  dialogVisible && (await page.getByRole("button", { name: "知道了" }).isVisible())
);

// 对话区不应有错误消息/banner（排除弹窗本体——弹窗内显示原始错误详情是设计）
const bodyText = await page.evaluate(() => {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('[role="dialog"]').forEach((d) => d.remove());
  return clone.innerText;
});
check(
  "问题4: 对话区无 [AI 请求失败] 字样",
  !bodyText.includes("[AI 请求失败]"),
  "  (存在!)"
);
check("问题4: 对话区无 401 字样", !bodyText.includes("401"), "  (存在!)");
check(
  "问题4: 对话区无错误重试按钮",
  (await page.getByRole("button", { name: "重试" }).count()) === 0,
  "  (存在重试按钮!)"
);

// 关闭弹窗后应能继续输入（streaming 状态已复位）
await page.getByRole("button", { name: "知道了" }).click();
await page.waitForTimeout(300);
const textareaDisabled = await page.locator("textarea").isDisabled();
check("问题4: 关闭弹窗后输入框可用", !textareaDisabled);

await browser.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
