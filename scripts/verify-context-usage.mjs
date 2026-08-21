// 票 06 固定回放验证：上下文用量显示、增长、预警与异常降级。
// 用法：node scripts/verify-context-usage.mjs
// 前置：dev server 运行在 localhost:3000，MongoDB 可连，默认 AI_MODE=replay。
import { chromium } from "playwright-core";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const aiMode = process.env.AI_MODE || "replay";
if (aiMode !== "replay") {
  console.error("本脚本只允许 AI_MODE=replay");
  process.exit(1);
}
const envRaw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    })
);
if (!env.MONGODB_URI) {
  console.error("MONGODB_URI 缺失");
  process.exit(1);
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` ${detail}` : ""}`);
  }
};

await mongoose.connect(env.MONGODB_URI);
const Message = mongoose.model(
  "VContextUsageMessage",
  new mongoose.Schema({
    role: String,
    content: mongoose.Schema.Types.Mixed,
    tab_id: mongoose.Schema.Types.ObjectId,
    timestamp: Date,
  }),
  "messages"
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

const email = `verify-context-${Date.now()}@test.local`;
const password = "verify-pass-1234";
await page.goto(`${BASE}/register`);
await page.fill("#email", email);
await page.fill('input[type="password"]', password);
await page.locator('input[type="password"]').nth(1).fill(password);
await page.locator('form button[type="submit"]').click();
await page.waitForURL((url) => url.pathname !== "/register");
if (page.url().includes("/login")) {
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes("/login"));
}
await page.goto(`${BASE}/projects`);
await page.getByRole("button", { name: "新建项目" }).click();
await page.fill('input[placeholder="输入项目名称"]', "上下文用量验证");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /上下文用量验证/ }).click();
await page.waitForURL((url) => /\/projects\/[0-9a-f]{24}$/.test(url.pathname));
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await page.getByRole("button", { name: "创建", exact: true }).click();
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((url) => url.pathname.startsWith("/workspace/"));
const workRecordId = page.url().split("/").pop();
await page.getByRole("button", { name: /需求分析/ }).first().click();
await page.waitForLoadState("networkidle");

const tabs = await page.evaluate(async (id) => (await fetch(`/api/work-records/${id}/tabs`)).json(), workRecordId);
const tabId = tabs[0].id;

const usage = page.getByTestId("context-usage");
await usage.waitFor();
const initialText = await usage.textContent();
const readUsage = (text) => Number(text?.match(/上下文约 ([\d,]+)/)?.[1].replaceAll(",", ""));
const initialUsage = readUsage(initialText);
check("低用量状态显示", Number.isFinite(initialUsage), `(实际=${initialText})`);

const requestUrls = [];
page.on("request", (request) => requestUrls.push(request.url()));
const textarea = page.locator("textarea");
await textarea.fill("草稿内容".repeat(100));
await page.waitForTimeout(100);
const draftUsage = readUsage(await usage.textContent());
check("用量随当前草稿增长", draftUsage > initialUsage, `(初始=${initialUsage} 当前=${draftUsage})`);
check("估算不发起聊天或用量请求", !requestUrls.some((url) => url.endsWith("/chat") || url.includes("context")));

await Message.create({
  role: "user",
  content: "历史增长".repeat(100),
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(),
});
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByTestId("context-usage").waitFor();
const historyUsage = readUsage(await page.getByTestId("context-usage").textContent());
check("用量随历史对话增长", historyUsage > initialUsage, `(初始=${initialUsage} 历史=${historyUsage})`);

await Message.create({
  role: "user",
  content: "长历史".repeat(32_000),
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(),
});
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByTestId("context-usage").waitFor();
check("接近上限时显示预警", (await page.getByText("接近上限", { exact: true }).count()) === 1);

await Message.create({
  role: "user",
  content: null,
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(Date.now() + 1),
});
await page.reload();
await page.waitForLoadState("networkidle");
check("估算异常时静默隐藏", (await page.getByTestId("context-usage").count()) === 0);

await browser.close();
await mongoose.disconnect();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
