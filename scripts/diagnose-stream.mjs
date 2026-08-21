// 诊断工具（一次性）：复现原型 tab 流式对话，判断页面主线程是否卡死。
// - 监听 console 错误 / pageerror（React 渲染异常）
// - 流式期间每 3s 测 page.evaluate 响应性（主线程卡死时 evaluate 挂起）
// 前置：dev server 运行在 localhost:3000。用法: node scripts/diagnose-stream.mjs
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const email = `diag-${Date.now()}@test.local`;
const password = "verify-pass-1234";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

// 监听页面 JS 错误
let jsErrors = [];
page.on("pageerror", (err) => {
  jsErrors.push(`[pageerror] ${err.message.slice(0, 200)}`);
  console.log("❌ pageerror:", err.message.slice(0, 200));
});
page.on("console", (msg) => {
  if (msg.type() === "error") {
    jsErrors.push(`[console.error] ${msg.text().slice(0, 200)}`);
    console.log("❌ console.error:", msg.text().slice(0, 200));
  }
});

// 主线程响应性探针：每 3s 执行一次 evaluate('1+1')，测延迟
let probeTimer;
function startProbe() {
  let lastDelay = 0;
  probeTimer = setInterval(async () => {
    const t0 = Date.now();
    try {
      await page.evaluate(() => 1 + 1);
      lastDelay = Date.now() - t0;
      if (lastDelay > 3000) {
        console.log(`⚠️  evaluate 延迟 ${lastDelay}ms（主线程疑似繁忙）`);
      }
    } catch (e) {
      console.log(`❌ evaluate 失败: ${e.message.slice(0, 120)}`);
    }
  }, 3000);
}
function stopProbe() {
  if (probeTimer) clearInterval(probeTimer);
}

try {
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
  await page.fill('input[placeholder="输入项目名称"]', "诊断流式渲染");
  await page.locator('form button[type="submit"]').click();
  await page.getByRole("link", { name: /诊断流式渲染/ }).click();
  await page.waitForURL((u) => /\/projects\/[0-9a-f]{24}$/.test(u.pathname));
  await page.getByRole("button", { name: "新建工作记录" }).first().click();
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("link", { name: /未命名/ }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/workspace/"));

  // 建原型 tab
  const wrId = page.url().split("/").pop();
  await page.evaluate(async (wid) => {
    await fetch(`/api/work-records/${wid}/tabs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_type: "prototype" }),
    });
  }, wrId);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByText("原型 #1", { exact: true }).first().click();
  await page.waitForTimeout(600);

  // 发送开场白（触发方案 + HTML 快照输出）
  console.log("发送开场白…");
  await page.locator("textarea").fill(
    "请开始原型设计。\n产品：校园二手交易平台。\n核心功能：商品发布、分类浏览搜索、站内私聊、用户评价；发布与搜索是 P0。\n不做：物流配送、担保交易。\n请先给出你的整体方案（页面清单 + 用户流程），并生成 HTML 原型快照。"
  );
  await page.getByRole("button", { name: "发送" }).click();
  startProbe();

  // 等流式开始
  await page.waitForFunction(
    () => {
      const ta = document.querySelector("textarea");
      return ta && ta.disabled;
    },
    null,
    { timeout: 30000 }
  );
  console.log("✅ 流式已开始（textarea disabled）");

  // 通用：等流式结束，然后检查源码泄漏
  async function waitStreamEnd(label) {
    await page.waitForFunction(
      () => {
        const ta = document.querySelector("textarea");
        return ta && !ta.disabled;
      },
      null,
      { timeout: 720000 }
    );
    console.log(`✅ [${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${label} 流式结束`);
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 400));
    const htmlLeak = bodyText.includes("<!DOCTYPE") || bodyText.includes("<html");
    console.log(htmlLeak ? `❌ ${label} 页面仍显示 HTML 源码！` : `✅ ${label} 页面无 HTML 源码泄漏`);
    // 点掉可能出现的文件确认框
    try {
      const confirmBtn = page.getByRole("button", { name: "确认写入" });
      await confirmBtn.waitFor({ state: "visible", timeout: 4000 });
      await confirmBtn.click();
      console.log(`✅ ${label} 点击了「确认写入」`);
      await page.waitForTimeout(400);
    } catch {
      // 无确认框
    }
  }

  await waitStreamEnd("第 1 轮（方案+HTML）");

  // 第 2 轮：指正 → 修订 + 重新生成 HTML
  console.log(`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] 发送第 2 轮指正…`);
  await page.locator("textarea").fill(
    "整体方向可以。请修订一处：发布流程太繁琐，把「发布商品」合并为单页表单（标题、描述、价格、图片一步填完），去掉分步填写。请修订结构化文本并重新生成 HTML 原型快照。"
  );
  await page.getByRole("button", { name: "发送" }).click();
  await waitStreamEnd("第 2 轮（修订+HTML）");

  // 第 3 轮：完满确认 → 自检 + 原型.md
  console.log(`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] 发送第 3 轮完满…`);
  await page.locator("textarea").fill("完满。请按自检清单检查后输出原型.md。");
  await page.getByRole("button", { name: "发送" }).click();
  await waitStreamEnd("第 3 轮（完满+原型.md）");

  console.log("✅ 完整 3 轮流程走通，无卡死");
  await page.screenshot({ path: "scripts/diag-final.png", fullPage: true });
  console.log("截图已存 scripts/diag-final.png");
} catch (e) {
  console.log(`❌ [${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] 脚本异常:`, e.message.slice(0, 300));
} finally {
  stopProbe();
  console.log("--- JS 错误汇总 ---");
  console.log(jsErrors.length ? jsErrors.join("\n") : "无");
  await browser.close();
}
