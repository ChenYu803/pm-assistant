// AI 产品经理入职体验全流程浏览器回放：入口、场景、测试、认证边界和 B 路线。
// 用法：node scripts/verify-onboarding-experience.mjs
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const DOCUMENT_PATH = "/api/onboarding/career-document";
const QUESTION_TRANSITION_MS = 500;
const CORRECT_ANSWER_INDEXES = [2, 1, 1, 2, 1, 1, 2, 1, 0, 2];
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

async function expectPath(page, path, name) {
  const actual = new URL(page.url()).pathname + new URL(page.url()).search;
  check(name, actual === path, actual);
}

async function enterExperience(page, enterFirstScene = true) {
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("domcontentloaded");
  const onboardingLink = page.getByRole("link", { name: "先认识 AI 产品经理" });
  check("落地页提供入职体验入口", await onboardingLink.count() === 1);
  check("入职体验入口固定指向任务简报", await onboardingLink.getAttribute("href") === "/onboarding/brief");
  await Promise.all([
    page.waitForURL(`${BASE}/onboarding/brief`),
    onboardingLink.click(),
  ]);
  await expectPath(page, "/onboarding/brief", "无论身份都先进入任务简报");
  check("任务简报展示固定入职任务", await page.getByText(/大学生\s*AI 学习助手/).count() === 1);

  if (!enterFirstScene) return;

  const firstSceneLink = page.getByRole("link", { name: /进入第一个工作场景/ });
  await Promise.all([
    page.waitForURL(`${BASE}/onboarding/scenes?scene=1`),
    firstSceneLink.click(),
  ]);
  await expectPath(page, "/onboarding/scenes?scene=1", "任务简报进入第一个工作场景");
  check("第一个工作场景显示需求收集题", await page.getByRole("group", { name: "需求收集方法" }).count() === 1);
}

async function completeFirstScene(page) {
  const choices = page.getByRole("checkbox");
  check("第一个场景提供四个需求收集选项", await choices.count() === 4, `${await choices.count()} 项`);
  await choices.first().check();
  await page.getByRole("button", { name: /提交我的判断/ }).click();
  check("不完整选择显示即时纠正", await page.getByText("再想一步", { exact: true }).count() === 1);
  check("不完整选择不解锁下一场景", !(await page.getByRole("link", { name: /进入下一个工作场景/ }).isVisible()));

  for (let index = 1; index < 4; index++) await choices.nth(index).check();
  await page.getByRole("button", { name: /提交我的判断/ }).click();
  check("完整选择显示前辈反馈", await page.getByText("判断成立", { exact: true }).count() === 1);
  const continueLink = page.getByRole("link", { name: /进入下一个工作场景/ });
  await Promise.all([
    page.waitForURL(`${BASE}/onboarding/scenes?scene=2&entry=1`),
    continueLink.click(),
  ]);
  await expectPath(page, "/onboarding/scenes?scene=2&entry=1", "场景一按唯一顺序进入场景二");
}

async function submitCurrentQuestion(page) {
  const options = page.getByRole("group").getByRole("button");
  check("工作场景题提供四个判断选项", await options.count() === 4, `${await options.count()} 项`);
  await options.first().click();
  await page.getByRole("button", { name: /提交我的判断/ }).click();
  check("提交后展示前辈反馈和正确答案", (await page.getByText("前辈的反馈", { exact: true }).count()) === 1 && (await page.getByText("正确答案", { exact: true }).count()) === 1);
}

async function submitAssessment(page, answerIndexes) {
  await page.getByRole("button", { name: "开始测试" }).click();
  const radios = page.getByRole("radio");
  check("职业认知测试固定为十题四选一", await radios.count() === 40, `${await radios.count()} 项`);
  for (let index = 0; index < answerIndexes.length; index++) {
    await radios.nth(index * 4 + answerIndexes[index]).click();
  }
  await page.getByRole("button", { name: "查看测试结果" }).click();
  await page.getByRole("button", { name: "提交并查看结果" }).click();
  check("测试完成后展示逐题解析", await page.getByText(/题目 10 \/ 10/).count() === 1);
}

async function readDownload(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function fillRegistrationForm(page, email, password) {
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码").fill(password);
}

async function completeScene(page, scene, expectIncorrectFirst = false) {
  await submitCurrentQuestion(page);
  if (expectIncorrectFirst) {
    check("错误选择显示纠正且仍可继续", await page.getByText("再想一步", { exact: true }).count() === 1);
  }
  await page.getByRole("button", { name: /进入下一判断/ }).click();
  await page.waitForTimeout(QUESTION_TRANSITION_MS);
  await submitCurrentQuestion(page);
  const nextName = scene === 6 ? /进入职业认知测试/ : /进入下一个工作场景/;
  await page.getByRole("button", { name: nextName }).click();
  if (scene === 6) {
    await page.waitForURL(`${BASE}/onboarding/assessment`);
  } else {
    await page.waitForURL(`${BASE}/onboarding/scenes?scene=${scene + 1}`);
  }
}

async function verifyEphemeralProgress(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  await page.goto(`${BASE}/onboarding/scenes?scene=2`);
  await submitCurrentQuestion(page);
  await page.getByRole("button", { name: /进入下一判断/ }).click();
  await page.waitForTimeout(QUESTION_TRANSITION_MS);
  await submitCurrentQuestion(page);
  await page.getByRole("button", { name: /进入下一个工作场景/ }).click();
  await page.waitForURL(`${BASE}/onboarding/scenes?scene=3`);
  check("本次打开期间可返回已体验场景", await page.locator('a[href="/onboarding/scenes?scene=2"]').count() === 1);

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  check("刷新后不恢复已体验场景", await page.locator('a[href="/onboarding/scenes?scene=2"]').count() === 0);
  check("刷新后不恢复已提交答案", !(await page.getByRole("button", { name: /提交我的判断/ }).isEnabled()));
  await page.close();

  const reopenedPage = await context.newPage();
  reopenedPage.setDefaultTimeout(12000);
  await reopenedPage.goto(`${BASE}/onboarding/scenes?scene=3`);
  check("重新打开后不恢复已体验场景", await reopenedPage.locator('a[href="/onboarding/scenes?scene=2"]').count() === 0);
  check("重新打开后不恢复已提交答案", !(await reopenedPage.getByRole("button", { name: /提交我的判断/ }).isEnabled()));
  await reopenedPage.close();
  await context.close();
}

async function verifyMobileScene(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(12000);
  await page.goto(`${BASE}/onboarding/scenes?scene=2`);
  await submitCurrentQuestion(page);
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  check("390px 工作场景反馈状态无横向溢出", dimensions.scrollWidth === dimensions.clientWidth, `${dimensions.scrollWidth} / ${dimensions.clientWidth}`);
  await page.close();
}

async function verifyPracticeEntry(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`${BASE}/`);
  const practiceLink = page.getByRole("link", { name: "我已经准备好，开始做产品" });
  check("B 路线入口仍指向既有项目流程", await practiceLink.getAttribute("href") === "/projects");
  await Promise.all([
    page.waitForURL(/\/login\?callbackUrl=/),
    practiceLink.click(),
  ]);
  check("游客从 B 路线进入既有登录分流", new URL(page.url()).searchParams.get("callbackUrl") === "/projects");
  await Promise.all([
    page.waitForURL(`${BASE}/register`),
    page.getByRole("link", { name: "注册" }).click(),
  ]);
  const email = `practice-replay-${Date.now()}@example.com`;
  await fillRegistrationForm(page, email, "practice-test-123");
  await Promise.all([
    page.waitForURL(`${BASE}/projects`),
    page.getByRole("button", { name: "注册" }).click(),
  ]);
  const projectHeading = page.getByRole("heading", { name: "我的项目" });
  await projectHeading.waitFor({ state: "visible" });
  check("B 路线认证后回到四环流程项目起点", await projectHeading.count() === 1);

  const projectName = `#06 B 路线回放 ${Date.now()}`;
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByPlaceholder("输入项目名称").fill(projectName);
  await page.getByRole("button", { name: "创建" }).click();
  const projectLink = page.getByRole("link", { name: projectName });
  await projectLink.waitFor({ state: "visible" });
  await Promise.all([
    page.waitForURL(/\/projects\/.+/),
    projectLink.click(),
  ]);
  const workRecordHeading = page.getByRole("heading", { name: "工作记录", exact: true });
  await workRecordHeading.waitFor({ state: "visible" });
  check("B 路线可进入项目工作记录", await workRecordHeading.count() === 1);

  const recordName = `#06 工作记录 ${Date.now()}`;
  await page.getByRole("button", { name: "新建工作记录" }).first().click();
  await page.getByPlaceholder("工作记录名称（可选）").fill(recordName);
  await page.getByRole("button", { name: "创建" }).click();
  const recordLink = page.getByRole("link", { name: recordName });
  await recordLink.waitFor({ state: "visible" });
  await Promise.all([
    page.waitForURL(/\/workspace\/.+/),
    recordLink.click(),
  ]);
  const firstAgentEntry = page.getByText("从一个想法开始，四步走完产品闭环", { exact: true });
  await firstAgentEntry.waitFor({ state: "visible" });
  check("B 路线工作记录展示首个 Agent 入口", await firstAgentEntry.count() === 1);
  await page.getByRole("button", { name: /需求分析/ }).click();
  await page.getByText("需求分析 已就绪", { exact: true }).waitFor({ state: "visible" });
  check("B 路线可创建首个需求分析 Agent", await page.getByText("需求分析 已就绪", { exact: true }).count() === 1);
  await context.close();
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
page.setDefaultTimeout(15000);
const guestWriteRequests = [];
page.on("request", (request) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && new URL(request.url()).pathname.startsWith("/api/")) {
    guestWriteRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  }
});
const guestDocumentResponse = await page.request.get(`${BASE}${DOCUMENT_PATH}`);
check("游客不能直接请求精炼学习笔记", guestDocumentResponse.status() === 401, `状态码 ${guestDocumentResponse.status()}`);
check("游客直接请求不泄露精炼学习笔记正文", hash(await guestDocumentResponse.body()) !== hash(expectedDocument));

await enterExperience(page);
await completeFirstScene(page);
check("场景二前仅场景一可返回", (await page.locator('a[href="/onboarding/scenes?scene=1"]').count()) === 1 && (await page.locator('a[href="/onboarding/scenes?scene=3"]').count()) === 0);
await completeScene(page, 2, true);
check("场景三可返回已体验的场景二", await page.locator('a[href="/onboarding/scenes?scene=2"]').count() === 1);

const revisitSceneTwo = page.locator('a[href="/onboarding/scenes?scene=2"]');
await Promise.all([
  page.waitForURL(`${BASE}/onboarding/scenes?scene=2`),
  revisitSceneTwo.click(),
]);
check("返回场景后可重新作答", await page.getByRole("button", { name: "重新作答" }).count() === 1);
await page.getByRole("button", { name: "重新作答" }).click();
check("重新作答后恢复可提交状态", await page.getByRole("button", { name: /提交我的判断/ }).isEnabled());
await page.goto(`${BASE}/onboarding/scenes?scene=3`);

for (let scene = 3; scene <= 6; scene++) await completeScene(page, scene);
await expectPath(page, "/onboarding/assessment", "六个工作场景后进入职业认知测试");
check("游客主路径未创建服务端业务数据", guestWriteRequests.length === 0, guestWriteRequests.join(", "));

await submitAssessment(page, Array(10).fill(0));
check("有错题时展示对应复盘数量", await page.getByRole("heading", { name: "值得复盘的判断（9 题）" }).count() === 1);
await page.getByRole("button", { name: "重新测试" }).click();
await page.getByRole("button", { name: "重新开始测试" }).click();
check("重测回到测试开始页", await page.getByRole("button", { name: "开始测试" }).count() === 1);
await submitAssessment(page, CORRECT_ANSWER_INDEXES);
check("十题全对时展示额外祝贺", await page.getByText("十题全对，恭喜你完成了本轮全部判断！", { exact: true }).count() === 1);
await page.getByRole("button", { name: "重新测试" }).click();
await page.getByRole("button", { name: "重新开始测试" }).click();
check("可连续再次重测", await page.getByRole("button", { name: "开始测试" }).count() === 1);
await submitAssessment(page, CORRECT_ANSWER_INDEXES);
await page.setViewportSize({ width: 390, height: 844 });
const mobileWidth = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
check("390px 测试结果页无横向溢出", mobileWidth.scrollWidth === mobileWidth.clientWidth, `${mobileWidth.scrollWidth} / ${mobileWidth.clientWidth}`);
await page.setViewportSize({ width: 1440, height: 900 });

const documentLink = page.getByRole("link", { name: /获取精炼学习笔记/ });
check("游客测试完成后只能通过认证入口获取笔记", await documentLink.getAttribute("href") === `/login?callbackUrl=${encodeURIComponent(DOCUMENT_PATH)}`);
await Promise.all([
  page.waitForURL(/\/login\?callbackUrl=/),
  documentLink.click(),
]);
check("游客下载动作进入认证页", new URL(page.url()).pathname === "/login");
await Promise.all([
  page.waitForURL(/\/register\?callbackUrl=/),
  page.getByRole("link", { name: "注册" }).click(),
]);
const email = `onboarding-replay-${Date.now()}@example.com`;
await fillRegistrationForm(page, email, "onboarding-test-123");
const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "注册" }).click();
const download = await downloadPromise;
check("游客认证成功后立即下载精炼学习笔记", download.suggestedFilename() === "AI产品经理职业认知-v1.0.md", download.suggestedFilename());
check("游客认证后的下载正文与固定文件一致", hash(await readDownload(download)) === hash(expectedDocument));

await enterExperience(page);
check("已登录用户仍从相同任务简报开始", (await page.getByText("工作场景一 · 需求收集", { exact: true }).count()) === 1);
await completeFirstScene(page);
for (let scene = 2; scene <= 6; scene++) await completeScene(page, scene);
await expectPath(page, "/onboarding/assessment", "已登录用户沿相同主路径进入职业认知测试");
await submitAssessment(page, CORRECT_ANSWER_INDEXES);
const memberDocumentLink = page.getByRole("link", { name: /获取精炼学习笔记/ });
check("已登录用户结果页直接指向精炼学习笔记", await memberDocumentLink.getAttribute("href") === DOCUMENT_PATH);
const memberDownloadPromise = page.waitForEvent("download");
await memberDocumentLink.click();
const memberDownload = await memberDownloadPromise;
check("已登录用户点击后立即下载精炼学习笔记", memberDownload.suggestedFilename() === "AI产品经理职业认知-v1.0.md", memberDownload.suggestedFilename());
check("已登录用户下载正文与固定文件一致", hash(await readDownload(memberDownload)) === hash(expectedDocument));

await verifyEphemeralProgress(browser);
await verifyMobileScene(browser);
await verifyPracticeEntry(browser);
await browser.close();
console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
