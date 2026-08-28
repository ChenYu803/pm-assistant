// 职业认知测试浏览器专项：游客可访问、十题作答、结果复盘、认证回跳和固定笔记下载。
// 用法：node scripts/verify-career-assessment.mjs
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const DOCUMENT_PATH = "/api/onboarding/career-document";
const DOCUMENT_FILENAME = "AI产品经理职业认知-v1.0.md";
const expectedDocument = await readFile(path.join(process.cwd(), ".scratch", "pm-assistant-v1.4", "career-document.md"));
const hash = (content) => createHash("sha256").update(content).digest("hex");
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

const guestResponse = await page.request.get(`${BASE}${DOCUMENT_PATH}`);
check("游客直接请求不会获得精炼学习笔记", guestResponse.status() === 401, `状态码 ${guestResponse.status()}`);
check("游客响应不泄露固定文件正文", hash(await guestResponse.body()) !== hash(expectedDocument));

await page.goto(`${BASE}/onboarding/assessment`);
await page.waitForLoadState("domcontentloaded");
check("游客可以直接访问测试介绍页", (await page.getByRole("button", { name: "开始测试" }).count()) === 1);

await page.getByRole("button", { name: "开始测试" }).click();
check("答题页展示 THE DECISION ROOM 引导", (await page.getByText("THE DECISION ROOM", { exact: true }).count()) === 1);
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
await page.waitForTimeout(900);
check("提交后回到页面顶端", (await page.evaluate(() => window.scrollY)) <= 2);
check("复盘页展示 MENTOR REVIEW 标题", (await page.getByText("MENTOR REVIEW", { exact: true }).count()) === 1);
check("结果页展示十题逐题解析", (await page.getByText(/题目 10 \/ 10/).count()) === 1);
check("结果页展示精炼学习笔记入口", (await page.getByRole("link", { name: /获取精炼学习笔记/ }).count()) === 1);
const documentHref = await page.getByRole("link", { name: /获取精炼学习笔记/ }).getAttribute("href");
check("游客入口携带下载回调地址", documentHref === `/login?callbackUrl=${encodeURIComponent(DOCUMENT_PATH)}`, documentHref ?? "缺少 href");
check("游客入口说明认证成功后自动下载", (await page.getByText("登录或注册成功后，浏览器会立即下载固定的 Markdown 文件。", { exact: true }).count()) === 1);

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

const memberPage = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
memberPage.setDefaultTimeout(15000);
const email = `career-download-${Date.now()}@example.com`;
await memberPage.goto(`${BASE}/register?callbackUrl=${encodeURIComponent(DOCUMENT_PATH)}`);
await memberPage.getByLabel("邮箱").fill(email);
await memberPage.getByLabel("密码", { exact: true }).fill("career-test-123");
await memberPage.getByLabel("确认密码").fill("career-test-123");
const downloadPromise = memberPage.waitForEvent("download");
await memberPage.getByRole("button", { name: "注册" }).click();
const download = await downloadPromise;
check("游客注册成功后无需再次点击即开始下载", !!download);
check("下载文件名稳定", download.suggestedFilename() === DOCUMENT_FILENAME, download.suggestedFilename());
const stream = await download.createReadStream();
const chunks = [];
for await (const chunk of stream) chunks.push(chunk);
const actualDocument = Buffer.concat(chunks);
check("下载正文与产品固定文件逐字节一致", hash(actualDocument) === hash(expectedDocument), `${actualDocument.length} / ${expectedDocument.length} bytes`);

await memberPage.goto(`${BASE}/onboarding/assessment`);
await memberPage.getByRole("button", { name: "开始测试" }).click();
const memberRadios = memberPage.getByRole("radio");
for (let index = 0; index < 10; index++) {
  await memberRadios.nth(index * 4).click();
}
await memberPage.getByRole("button", { name: "查看测试结果" }).click();
await memberPage.getByRole("button", { name: "提交并查看结果" }).click();
const memberDocumentLink = memberPage.getByRole("link", { name: /获取精炼学习笔记/ });
check("已登录用户入口直接指向下载地址", await memberDocumentLink.getAttribute("href") === DOCUMENT_PATH);
const memberDownloadPromise = memberPage.waitForEvent("download");
await memberDocumentLink.click();
const memberDownload = await memberDownloadPromise;
check("已登录用户点击入口后立即下载", memberDownload.suggestedFilename() === DOCUMENT_FILENAME);

const loginContext = await browser.newContext({ acceptDownloads: true });
const loginPage = await loginContext.newPage();
loginPage.setDefaultTimeout(15000);
await loginPage.goto(`${BASE}/login?callbackUrl=${encodeURIComponent(DOCUMENT_PATH)}`);
await loginPage.getByLabel("邮箱").fill(email);
await loginPage.getByLabel("密码").fill("career-test-123");
const loginDownloadPromise = loginPage.waitForEvent("download");
await loginPage.getByRole("button", { name: "登录" }).click();
const loginDownload = await loginDownloadPromise;
check("已有账号登录成功后无需再次点击即开始下载", loginDownload.suggestedFilename() === DOCUMENT_FILENAME);
await loginContext.close();

await browser.close();
console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
