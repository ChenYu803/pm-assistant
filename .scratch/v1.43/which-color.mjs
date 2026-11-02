// 列出某元素上所有设置 color 的匹配规则（按样式表顺序），用于定位特异性压制的来源。
import { chromium } from "playwright-core";

const url = process.argv[2];
const sel = process.argv[3] || "[class*=primary]";
const browser = await chromium.launch({
  executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
const hits = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return ["NOT FOUND"];
  const out = [];
  for (const sh of document.styleSheets) {
    let rules;
    try {
      rules = sh.cssRules;
    } catch (e) {
      continue;
    }
    for (const rule of rules) {
      if (!rule.selectorText) continue;
      for (const raw of rule.selectorText.split(",")) {
        const s = raw.trim();
        let match = false;
        try {
          match = el.matches(s);
        } catch (e) {
          match = false;
        }
        if (match && rule.style.color) out.push(`${s} { color: ${rule.style.color} }`);
      }
    }
  }
  const st = getComputedStyle(el);
  out.push(`FINAL color=${st.color} bg=${st.backgroundColor}`);
  return out;
}, sel);
console.log(hits.join("\n"));
await browser.close();
