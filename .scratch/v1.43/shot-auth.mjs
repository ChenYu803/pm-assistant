import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
for (const [name, url] of [["login", "http://localhost:3000/login"], ["register", "http://localhost:3000/register"], ["brief", "http://localhost:3000/onboarding/brief"]]) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(name, "overflowX=", overflow, "bg=", await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await page.screenshot({ path: `.scratch/v1.43/dark-${name}.png` });
}
await browser.close();
