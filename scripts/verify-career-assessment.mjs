// 职业认知测试浏览器专项：游客可访问、十题作答、提交确认、结果复盘、重测和认证回跳。
// 用法：node scripts/verify-career-assessment.mjs
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? `：${detail}` : ""}`);
  }
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(12000);

await page.goto(`${BASE}/onboarding/assessment`);
await page.waitForLoadState("domcontentloaded");
check("游客可以直接访问测试介绍页", (await page.getByRole("button", { name: "开始测试" }).count()) === 1);

await page.getByRole("button", { name: "开始测试" }).click();
const radios = page.getByRole("radio");
check("固定十题、每题四个选项", (await radios.count()) === 40, `选项数 ${await radios.count()}`);
const submit = page.getByRole("button", { name: "请选择答案" });
check("未完成十题时提交按钮禁用", !(await submit.isEnabled()));

for (let index = 0; index < 10; index++) {
  await radios.nth(index * 4).click();
}
const resultButton = page.getByRole("button", { name: "查看测试结果" });
check("十题全部选择后提交按钮启用", await resultButton.isEnabled());
await resultButton.click();
check("提交确认弹窗出现", (await page.getByRole("dialog").count()) === 1);
await page.getByRole("button", { name: "提交并查看结果" }).click();
check("结果页展示十题逐题解析", (await page.getByText(/题目 10 \/ 10/).count()) === 1);
check("结果页展示精炼学习笔记入口", (await page.getByRole("link", { name: /获取精炼学习笔记/ }).count()) === 1);
const documentHref = await page.getByRole("link", { name: /获取精炼学习笔记/ }).getAttribute("href");
check("游客入口携带认知文件回调地址", documentHref === "/login?callbackUrl=%2Fonboarding%2Fcareer-document", documentHref ?? "缺少 href");

await page.getByRole("button", { name: "重新测试" }).click();
await page.getByRole("button", { name: "重新开始测试" }).click();
await page.getByRole("button", { name: "开始测试" }).click();
const correctAnswers = ["C", "B", "B", "C", "B", "B", "C", "B", "A", "C"];
for (let index = 0; index < correctAnswers.length; index++) {
  const letters = ["A", "B", "C", "D"];
  await page.getByRole("radio").nth(index * 4 + letters.indexOf(correctAnswers[index])).click();
}
await page.getByRole("button", { name: "查看测试结果" }).click();
await page.getByRole("button", { name: "提交并查看结果" }).click();
check("十题全对时显示祝贺反馈", (await page.getByText("十题全对，恭喜你完成了本轮全部判断！").count()) === 1);

await page.getByRole("button", { name: "重新测试" }).click();
await page.getByRole("button", { name: "重新开始测试" }).click();
check("重测清空结果并回到介绍页", (await page.getByRole("button", { name: "开始测试" }).count()) === 1);

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/onboarding/assessment`);
const mobileWidth = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
check("390px 移动布局无横向溢出", mobileWidth.scrollWidth === mobileWidth.clientWidth, `${mobileWidth.scrollWidth} / ${mobileWidth.clientWidth}`);

await browser.close();
console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
