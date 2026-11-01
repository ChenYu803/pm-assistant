// 定向检查：首页底色、真实输入驱动、无动画与响应式边界。不调用模型，不写业务数据。
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";

const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const evidence = ".scratch/v1.43/evidence/landing";
await mkdir(evidence, { recursive: true });
let pass = 0, fail = 0;
const measurements = [];
const check = (name, ok, detail = "") => {
  console.log((ok ? "✅ " : "❌ ") + name + (detail ? " " + detail : ""));
  if (ok) pass++; else fail++;
};
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", e => errors.push(e.message));
await page.goto("http://localhost:3000");
await page.locator('[data-motion="ready"]').waitFor();
const stage = page.locator("[data-artifact-stage]");
const stack = stage.locator('[class*="artifactStack"]');
const pose = () => stack.evaluate(el => getComputedStyle(el).transform);
const neutral = await pose();
const box = await stage.boundingBox();
await page.mouse.move(box.x + box.width * .88, box.y + box.height * .25, { steps: 12 });
await page.waitForTimeout(500);
const pointed = await pose();
check("真实鼠标使文件台产生纵深", neutral !== pointed, pointed);
await page.mouse.move(5, 5);
await page.waitForTimeout(650);
const returned = await pose();
await page.waitForTimeout(200);
check("离开后回正并静止", neutral === returned && returned === await pose());

for (const label of ["需求分析", "原型", "PRD", "任务拆分"]) {
  const button = page.getByRole("button", { name: new RegExp(label + "$") });
  await button.click();
  check("成果可点选：" + label, await button.getAttribute("aria-pressed") === "true");
}
const first = page.getByRole("button", { name: /需求分析$/ });
await first.focus();
await page.keyboard.press("Enter");
check("键盘能切换且焦点可见", await first.getAttribute("aria-pressed") === "true" && await first.evaluate(el => getComputedStyle(el).outlineStyle !== "none"));
await page.screenshot({ path: evidence + "/desktop-hero.png" });

// 使用真实滚轮穿越完整驻留区；同时读 CSS 渲染矩阵和阶段，不能只读写入值。
await page.mouse.move(1000, 600);
const states = [];
for (let i = 0; i < 100; i++) {
  const state = await page.locator("#practice").evaluate(el => ({
    top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom,
    phase: Number(el.dataset.phase), progress: Number(el.dataset.progress),
    pin: el.firstElementChild.getBoundingClientRect().top,
    matrices: [...el.querySelectorAll("[data-delivery-sheet]")].map(e => getComputedStyle(e).transform),
  }));
  states.push(state);
  if (state.progress >= .35 && state.progress <= .7) await page.screenshot({ path: evidence + "/desktop-handoff.png" });
  if (state.bottom < 800) break;
  // 1400px 的驻留带用 180px 步长最多只有约 8 个样本，无法证明连续重组。
  // 改用真实 60px 滚轮步长，保证每段交接均有多个中间姿态。
  await page.mouse.wheel(0, 60);
  await page.waitForTimeout(60);
}
const phases = [...new Set(states.filter(s => s.top <= 1 && s.bottom >= 999).map(s => s.phase))];
check("真实滚轮走完四个交付阶段", phases.length === 4, JSON.stringify(phases));
check("驻留时原生容器继续滚动，内容保持在屏内", states.filter(s => s.top < 0 && s.bottom > 1000).every(s => Math.abs(s.pin) < 1));
const uniquePoses = new Set(states.map(s => s.matrices.join())).size;
check("文件在滚动中连续重组", uniquePoses > 12, String(uniquePoses) + " 个不同渲染姿态");
const forward = await page.locator("#practice").getAttribute("data-progress");
await page.mouse.wheel(0, -700);
await page.waitForTimeout(100);
const backward = Number(await page.locator("#practice").getAttribute("data-progress"));
check("反向滚动可逆", backward < Number(forward), forward + " → " + backward);
measurements.push({ scrollStates: states, phases, uniquePoses, forward: Number(forward), backward });

for (const width of [320, 375, 390, 414, 768, 1440]) {
  await page.setViewportSize({ width, height: width > 900 ? 1000 : 844 });
  await page.goto("http://localhost:3000");
  await page.locator('[data-motion="ready"]').waitFor();
  const report = await page.evaluate(() => {
    const scroller = document.querySelector("body > main");
    const root = document.querySelector('[data-motion="ready"]');
    const light = [...root.querySelectorAll("*"), document.body, scroller, document.documentElement].filter(e => {
      const bg = getComputedStyle(e).backgroundColor.match(/^rgba?\(([^)]+)\)/);
      if (!bg) return false;
      const values = bg[1].split(",").map(Number);
      return (values[3] ?? 1) > .95 && Math.min(...values.slice(0, 3)) > 210;
    }).map(e => e.tagName + "." + e.className);
    return { width: innerWidth, document: document.documentElement.scrollWidth, scroll: scroller.scrollWidth, light, body: getComputedStyle(document.body).backgroundColor };
  });
  measurements.push(report);
  check(width + "px 无横向溢出", report.document === width && report.scroll === width, JSON.stringify(report));
  check(width + "px 无白色或近白底面", report.light.length === 0);
  for (const button of await page.getByRole("group", { name: "切换成果示意" }).getByRole("button").all()) {
    await button.click();
    check(width + "px 成果点击切换", await button.getAttribute("aria-pressed") === "true");
  }
  if (width === 390) await page.screenshot({ path: evidence + "/mobile-files.png" });
  if (width === 1440) {
    const hoverButton = page.getByRole("button", { name: /需求分析$/ });
    await hoverButton.hover();
    // 颜色过渡需要完成；过渡中颜色不等于目标值不能解释成白底。
    await page.waitForFunction(() => {
      const button = document.querySelector('[role="group"][aria-label="切换成果示意"] button');
      return getComputedStyle(button).backgroundColor === "rgb(34, 35, 29)";
    });
    const color = await hoverButton.evaluate(el => getComputedStyle(el).backgroundColor);
    check("hover 仍使用深色底面", color === "rgb(34, 35, 29)", color);
    measurements.push({ hoverColor: color });
  }
}

// 必须单独启动真实触摸上下文；桌面 tap 失败后回退 click 不能证明触控。
const touchPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await touchPage.goto("http://localhost:3000");
await touchPage.locator('[data-motion="ready"]').waitFor();
const touchButtons = touchPage.getByRole("group", { name: "切换成果示意" }).getByRole("button");
for (const button of await touchButtons.all()) {
  await button.tap();
  check("390px 真实触屏切换", await button.getAttribute("aria-pressed") === "true");
}
await touchPage.close();

await page.emulateMedia({ reducedMotion: "reduce" });
await page.goto("http://localhost:3000");
await page.locator('[data-motion="ready"]').waitFor();
await page.screenshot({ path: evidence + "/reduced-hero.png" });
check("减弱动画呈现四份完整文档", await page.locator("[data-delivery-sheet]").evaluateAll(nodes => nodes.every(el => getComputedStyle(el).position === "relative" && getComputedStyle(el).opacity === "1")));
check("减弱动画没有残留循环动画", await page.evaluate(() => document.getAnimations().length === 0));
const noJS = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
await noJS.goto("http://localhost:3000");
check("无 JS 保留内容和入口", await noJS.locator("[data-delivery-sheet]").count() === 4 && await noJS.getByRole("link", { name: "先认识 AI 产品经理", exact: true }).getAttribute("href") === "/onboarding/brief");
await noJS.close();
await page.getByRole("link", { name: "先认识 AI 产品经理", exact: true }).click();
await page.waitForURL("**/onboarding/brief");
check("业务入口和路由正常", new URL(page.url()).pathname === "/onboarding/brief");
check("深色底面不泄漏到其他页面", await page.evaluate(() => getComputedStyle(document.body).backgroundColor !== "rgb(23, 23, 19)"));
check("浏览器无运行错误", errors.length === 0, JSON.stringify(errors));
await writeFile(evidence + "/measurements.json", JSON.stringify({ pass, fail, measurements, errors }, null, 2));
await browser.close();
console.log("检查完成：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);
