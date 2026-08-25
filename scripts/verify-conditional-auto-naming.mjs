// 自动命名只能条件更新，不能覆盖手动命名或其他 tab 的先成功结果。
// 用法：AI_MODE=replay AUTO_NAME_TEST_HOOKS=1 npm run verify:mysql-auto-naming
import { chromium } from "playwright-core";
import { assertReplayEnvironment } from "./verify-mysql-fixtures.mjs";
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

try {
  assertReplayEnvironment();
} catch (error) {
  console.error(`❌ ${error.message}`);
  console.log("\n结果: 0 通过, 1 失败（未运行）");
  process.exit(1);
}
if (process.env.AUTO_NAME_TEST_HOOKS !== "1") {
  console.error("❌ #08 验证需要 AUTO_NAME_TEST_HOOKS=1");
  process.exit(1);
}

// 在打开浏览器或发送聊天请求前终止，避免误连 live 服务。
let replayMode;
try {
  const replayResponse = await fetch(`${BASE}/api/verify/replay-mode`, {
    cache: "no-store",
  });
  replayMode = await replayResponse.json();
} catch {
  console.error("❌ 无法确认服务端 AI_MODE=replay");
  process.exit(1);
}
if (replayMode?.aiMode !== "replay") {
  console.error("❌ 服务端不是 AI_MODE=replay，已停止验证");
  process.exit(1);
}

let pass = 0;
let fail = 0;
const check = (name, ok) => {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}`);
  }
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15_000);

const api = (pathname, init = {}) =>
  page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, requestInit);
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: response.status, body };
    },
    { requestPath: pathname, requestInit: init }
  );

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function createProject(name) {
  return api("/api/projects", json({ name }));
}

async function createWorkRecord(projectId) {
  return api(`/api/projects/${projectId}/work-records`, json({}));
}

async function createTab(workRecordId) {
  return api(
    `/api/work-records/${workRecordId}/tabs`,
    json({ agent_type: "requirement_analyst" })
  );
}

async function autoName(workRecordId, name, delayMs = 0) {
  return api(
    "/api/verify/conditional-auto-naming",
    json({ workRecordId, name, delayMs })
  );
}

async function manualName(workRecordId, name) {
  return api(`/api/work-records/${workRecordId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

async function sendReplayChat(tab) {
  return api(`/api/tabs/${tab.id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: "为自动命名验证补足对话轮次",
      expectedVersion: tab.version,
      requestId: `auto-name-chat-${Date.now()}`,
    }),
  });
}

async function currentTab(workRecordId) {
  const tabs = await api(`/api/work-records/${workRecordId}/tabs`);
  return { response: tabs, tab: tabs.body?.[0] };
}

async function requestAutomaticName(workRecordId, tabId, headers = {}) {
  return api(`/api/work-records/${workRecordId}/auto-name`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ tabId }),
  });
}

try {
  const email = `verify-auto-name-${Date.now()}@test.local`;
  await page.goto(`${BASE}/register`);
  await page.fill("#email", email);
  await page.fill('input[type="password"]', "verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes("/register"));
  if (page.url().includes("/login")) {
    await page.fill("#email", email);
    await page.fill("#password", "verify-pass-1234");
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.includes("/login"));
  }

  check("服务端确认 AI_MODE=replay", replayMode?.aiMode === "replay");

  const project = await createProject(`自动命名验证-${Date.now()}`);
  const projectId = project.body?.id;
  const concurrentRecord = await createWorkRecord(projectId);
  const concurrentRecordId = concurrentRecord.body?.id;
  const [tabA, tabB] = await Promise.all([
    createTab(concurrentRecordId),
    createTab(concurrentRecordId),
  ]);
  const candidates = ["窗口 A 自动名称", "窗口 B 自动名称"];
  const concurrentResults = await Promise.all(
    candidates.map((name) => autoName(concurrentRecordId, name))
  );
  const afterConcurrent = await api(`/api/work-records/${concurrentRecordId}`);
  const applied = concurrentResults.filter((result) => result.body?.applied);
  check(
    "两个 tab 同时自动命名只有一个条件更新成功",
    tabA.status === 201 &&
      tabB.status === 201 &&
      applied.length === 1 &&
      candidates.includes(afterConcurrent.body?.name)
  );

  const manualRecord = await createWorkRecord(projectId);
  const manualRecordId = manualRecord.body?.id;
  const lateAutomaticName = autoName(manualRecordId, "过期自动名称", 300);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const manualRename = await manualName(manualRecordId, "用户手动名称");
  const lateResult = await lateAutomaticName;
  const afterManual = await api(`/api/work-records/${manualRecordId}`);
  await page.goto(`${BASE}/workspace/${manualRecordId}`);
  await page.getByRole("button", { name: "用户手动名称", exact: true }).waitFor();
  const manualNameInWorkspace = await page
    .getByRole("button", { name: "用户手动名称", exact: true })
    .count();
  check(
    "手动改名抢先成功后，等待中的自动命名不会覆盖 API 和工作区名称",
    manualRename.status === 200 &&
      lateResult.status === 200 &&
      lateResult.body?.applied === false &&
      afterManual.body?.name === "用户手动名称" &&
      manualNameInWorkspace > 0
  );

  const uiRecord = await createWorkRecord(projectId);
  const uiRecordId = uiRecord.body?.id;
  const uiTab = await createTab(uiRecordId);
  const firstUiChat = await sendReplayChat(uiTab.body?.tab);
  const refreshedUiTab = await currentTab(uiRecordId);
  const secondUiChat = await sendReplayChat(refreshedUiTab.tab);
  const successfulAutoName = await requestAutomaticName(
    uiRecordId,
    uiTab.body?.tab?.id,
    { "x-auto-name-test-name": "auto-name-ui" }
  );
  await page.goto(`${BASE}/workspace/${uiRecordId}`);
  const uiTitleLocator = page.locator("nav button").filter({
    hasText: "auto-name-ui",
  });
  await uiTitleLocator.waitFor();
  const uiTitle = await uiTitleLocator.count();
  check(
    "聊天完成后条件自动命名，工作区标题显示实际结果",
    firstUiChat.status === 200 &&
      typeof firstUiChat.body === "string" &&
      firstUiChat.body.includes('"type":"done"') &&
      refreshedUiTab.response.status === 200 &&
      secondUiChat.status === 200 &&
      typeof secondUiChat.body === "string" &&
      secondUiChat.body.includes('"type":"done"') &&
      successfulAutoName.status === 200 &&
      successfulAutoName.body?.name === "auto-name-ui" &&
      uiTitle === 1
  );

  const failureRecord = await createWorkRecord(projectId);
  const failureRecordId = failureRecord.body?.id;
  const failureTab = await createTab(failureRecordId);
  const firstFailureChat = await sendReplayChat(failureTab.body?.tab);
  const refreshedFailureTab = await currentTab(failureRecordId);
  const secondFailureChat = await sendReplayChat(refreshedFailureTab.tab);
  const failedAutoName = await requestAutomaticName(
    failureRecordId,
    failureTab.body?.tab?.id,
    { "x-auto-name-test-failure": "1" }
  );
  const postFailureTab = await currentTab(failureRecordId);
  const chatAfterFailure = await sendReplayChat(postFailureTab.tab);
  const renameAfterFailure = await manualName(failureRecordId, "失败后仍可改名");
  const afterFailure = await api(`/api/work-records/${failureRecordId}`);
  check(
    "自动命名内部失败不阻塞聊天和手动改名",
    firstFailureChat.status === 200 &&
      typeof firstFailureChat.body === "string" &&
      firstFailureChat.body.includes('"type":"done"') &&
      secondFailureChat.status === 200 &&
      typeof secondFailureChat.body === "string" &&
      secondFailureChat.body.includes('"type":"done"') &&
      failedAutoName.status === 200 &&
      failedAutoName.body?.name === null &&
      failedAutoName.body?.testFailureInjected === true &&
      chatAfterFailure.status === 200 &&
      typeof chatAfterFailure.body === "string" &&
      chatAfterFailure.body.includes('"type":"done"') &&
      renameAfterFailure.status === 200 &&
      afterFailure.body?.name === "失败后仍可改名"
  );
} finally {
  await browser.close();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
