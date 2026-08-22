// Markdown 安全渲染专项回放：固定恶意输入，检查用户可见的 DOM 安全边界。
// 用法：AI_MODE=replay node scripts/verify-markdown-safety.mjs
import { chromium } from "playwright-core";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const aiMode = process.env.AI_MODE ?? "replay";

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
    }),
);
const MONGODB_URI = env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI 缺失");
  process.exit(1);
}

const email = `verify-markdown-${Date.now()}@test.local`;
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

await mongoose.connect(MONGODB_URI);
const Message = mongoose.model(
  "VMarkdownSafetyMessage",
  new mongoose.Schema({
    role: String,
    content: String,
    tab_id: mongoose.Schema.Types.ObjectId,
    timestamp: Date,
  }),
  "messages",
);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

try {
  const replayRes = await page.request.get(`${BASE}/api/verify/replay-mode`);
  const replayBody = await replayRes.json();
  check("服务端确认 AI_MODE=replay", replayBody.aiMode === "replay");

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
  await page.fill('input[placeholder="输入项目名称"]', "Markdown 安全验证");
  await page.locator('form button[type="submit"]').click();
  await page.getByRole("link", { name: /Markdown 安全验证/ }).click();
  await page.waitForURL((url) => /\/projects\/[0-9a-f]{24}$/.test(url.pathname));
  await page.getByRole("button", { name: "新建工作记录" }).first().click();
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("link", { name: /未命名/ }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/workspace/"));
  const workRecordId = page.url().split("/").pop();

  await page.getByRole("button", { name: /需求分析/ }).first().click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const tabs = await page.evaluate(async (id) => (await fetch(`/api/work-records/${id}/tabs`)).json(), workRecordId);
  const tabId = tabs[0].id;
  const now = new Date();
  await Message.create({
    role: "assistant",
    tab_id: new mongoose.Types.ObjectId(tabId),
    timestamp: now,
    content: [
      "## 安全输入回放",
      "",
      "[安全链接](https://example.com/docs)",
      "[邮件](mailto:pm@example.com)",
      "[危险链接](javascript:alert(1))",
      '[属性注入](https://example.com/\" onmouseover=\"alert(1))',
      "",
      '<img src=x onerror=\"alert(1)\"> <script>alert(1)</script>',
      "",
      '```typescript',
      "const answer = 42;",
      "```",
      "",
      '```javascript\" onmouseover=\"alert(1)',
      "const unsafe = true;",
      "```",
    ].join("\n"),
  });

  await page.reload();
  await page.waitForTimeout(1000);
  const observed = await page.evaluate(() => {
    const prose = document.querySelector(".prose");
    const anchors = [...document.querySelectorAll(".prose a")].map((anchor) => ({
      href: anchor.getAttribute("href"),
      text: anchor.textContent,
    }));
    const codeClasses = [...document.querySelectorAll(".prose pre code")].map((code) => code.className);
    const attributes = [...document.querySelectorAll(".prose *")].flatMap((element) =>
      [...element.attributes].map((attribute) => attribute.name),
    );
    return {
      anchors,
      codeClasses,
      hasScript: !!document.querySelector(".prose script"),
      hasImage: !!document.querySelector(".prose img"),
      hasHeading: !!document.querySelector(".prose h2"),
      hasPre: !!document.querySelector(".prose pre"),
      body: prose?.textContent ?? "",
      hasEventAttribute: attributes.some((name) => name.toLowerCase().startsWith("on")),
    };
  });

  check("http/https/mailto 保持为可用链接", observed.anchors.length === 2 && observed.anchors.every(({ href }) => /^(https?:|mailto:)/i.test(href ?? "")), JSON.stringify(observed.anchors));
  check("危险协议不生成链接", !observed.anchors.some(({ text }) => text === "危险链接"), JSON.stringify(observed.anchors));
  check("属性注入不改变 DOM 结构", !observed.hasEventAttribute && observed.anchors.length === 2, JSON.stringify({ anchors: observed.anchors, hasEventAttribute: observed.hasEventAttribute }));
  check("HTML 注入按文本显示", !observed.hasScript && !observed.hasImage && observed.body.includes("alert(1)"), JSON.stringify({ hasScript: observed.hasScript, hasImage: observed.hasImage }));
  check("安全语言名保留样式标记", observed.codeClasses.some((name) => name.includes("language-typescript")), JSON.stringify(observed.codeClasses));
  check("恶意语言名不注入 class", observed.codeClasses.every((name) => !name.includes("onmouseover") && !name.includes("alert")), JSON.stringify(observed.codeClasses));
  check("普通 Markdown 结构不回归", observed.hasHeading && observed.hasPre, JSON.stringify({ hasHeading: observed.hasHeading, hasPre: observed.hasPre }));
} finally {
  await browser.close();
  await mongoose.disconnect();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
