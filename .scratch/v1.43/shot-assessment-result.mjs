import { chromium } from "playwright-core";
const B = "http://localhost:3000";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.goto(B + "/onboarding/assessment", { waitUntil: "networkidle" });
await page.click("button:has-text('开始测试')");
await page.waitForTimeout(400);
// 每题选第一个选项
const groups = page.locator("[role=radiogroup]");
const n = await groups.count();
for (let i = 0; i < n; i++) {
  await groups.nth(i).locator("[role=radio]").first().click();
  await page.waitForTimeout(40);
}
await page.click("button:has-text('查看测试结果')");
await page.waitForTimeout(300);
// 弹窗确认
const confirm = page.locator("button:has-text('提交并查看结果')");
if (await confirm.count()) { await confirm.click(); await page.waitForTimeout(600); }
await page.waitForSelector("section:has-text('COMPLETION NOTE')", { timeout: 8000 });
const sec = page.locator("section", { hasText: "COMPLETION NOTE" }).last();
await sec.scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await sec.screenshot({ path: ".scratch/v1.43/assessment-result-cta.png" });
// 读出三个动作与两条说明
const info = await page.evaluate(() => {
  const box = [...document.querySelectorAll("section")].find((s) => s.textContent.includes("COMPLETION NOTE"));
  const acts = [...box.querySelectorAll("a,button")].filter((el) => /重新测试|精炼学习笔记|真实开发工作流/.test(el.textContent)).map((el) => ({ tag: el.tagName, text: el.textContent.trim(), href: el.getAttribute("href"), bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color, border: getComputedStyle(el).borderTopColor }));
  const notes = [...box.querySelectorAll("strong")].map((s) => ({ title: s.textContent, body: s.parentElement.querySelector("p")?.textContent }));
  const lead = [...box.querySelectorAll("p")].map((p) => p.textContent).filter((t) => t.includes("千里之行"));
  return { acts, notes, lead };
});
console.log(JSON.stringify(info, null, 1));
const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflowX:", ov);
await browser.close();
