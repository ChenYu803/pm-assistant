// v1.2 #09 固定回放：显式范围冻结的两阶段协议。
// 用法：AI_MODE=replay node scripts/verify-explicit-freeze-protocol.mjs
// 前置：dev server 运行在 localhost:3000，MongoDB 可连；禁止使用 AI_MODE=live。
import { chromium } from "playwright-core";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.AI_MODE === "live") {
  console.error("❌ 验证拒绝 AI_MODE=live；请使用 AI_MODE=replay");
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const envRaw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    })
);
if (!env.MONGODB_URI) {
  console.error("❌ MONGODB_URI 缺失");
  process.exit(1);
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}${detail ? ` ${detail}` : ""}`);
  }
};

await mongoose.connect(env.MONGODB_URI);
const Message = mongoose.model(
  "VExplicitFreezeMessage",
  new mongoose.Schema(
    { tab_id: mongoose.Schema.Types.ObjectId, request_id: String, status: String },
    { collection: "messages" }
  )
);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext();
const page = await context.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20_000);
await page.addInitScript(() => {
  window.__verifyFreezeSlow = false;
  window.__verifyFreezeError = false;
  window.__verifyFreezeWriteFailure = false;
  window.__verifyFreezeRequests = [];
  window.__verifyFreezeFileWrites = [];
  window.__verifyFreezeReplaceBeforeComplete = null;
  window.__verifyFreezeCompleteResults = [];
  const originalFetch = window.fetch;
  window.fetch = async (input, init = {}) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    if (url.endsWith("/chat") && body?.freeze === true) {
      window.__verifyFreezeRequests.push(body);
      const headers = new Headers(init.headers);
      if (window.__verifyFreezeSlow) headers.set("x-pm-verify-stream-delay", "1");
      if (window.__verifyFreezeError) headers.set("x-pm-verify-force-error", "zero-token");
      return originalFetch(input, { ...init, headers });
    }
    if (
      window.__verifyFreezeWriteFailure &&
      /\/api\/projects\/[^/]+\/files$/.test(url) &&
      init.method === "POST"
    ) {
      return new Response(JSON.stringify({ error: "回放强制写入失败" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (
      /\/api\/projects\/[^/]+\/files$/.test(url) &&
      init.method === "POST"
    ) {
      const response = await originalFetch(input, init);
      window.__verifyFreezeFileWrites.push({
        filename: body?.filename,
        agentType: body?.agent_type,
        status: response.status,
      });
      return response;
    }
    if (
      window.__verifyFreezeReplaceBeforeComplete &&
      /\/api\/tabs\/[^/]+\/freeze$/.test(url) &&
      body?.action === "complete"
    ) {
      const replacement = window.__verifyFreezeReplaceBeforeComplete;
      window.__verifyFreezeReplaceBeforeComplete = null;
      const replacementResponse = await originalFetch(
        `/api/projects/${replacement.projectId}/files`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: replacement.filename,
            content: replacement.content,
            agent_type: replacement.agentType,
          }),
        }
      );
      const response = await originalFetch(input, init);
      window.__verifyFreezeCompleteResults.push({
        request: body,
        response: {
          status: response.status,
          text: await response.clone().text(),
        },
        replacementStatus: replacementResponse.status,
      });
      return response;
    }
    if (/\/api\/tabs\/[^/]+\/freeze$/.test(url)) {
      window.__verifyFreezeRequests.push({ type: "file-confirm", body });
    }
    return originalFetch(input, init);
  };
});

const api = (pathname, init = {}) =>
  page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, requestInit);
      return { status: response.status, text: await response.text() };
    },
    { requestPath: pathname, requestInit: init }
  );

const readTabs = async (workRecordId) => {
  const result = await api(`/api/work-records/${workRecordId}/tabs`);
  if (result.status !== 200) throw new Error("无法读取标签页");
  return JSON.parse(result.text);
};

const tabById = async (workRecordId, tabId) =>
  (await readTabs(workRecordId)).find((tab) => tab.id === tabId);

const waitForTab = async (workRecordId, tabId, predicate) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const tab = await tabById(workRecordId, tabId);
    if (tab && predicate(tab)) return tab;
    await page.waitForTimeout(100);
  }
  throw new Error("冻结状态未在时限内达到预期");
};

const postChat = (tabId, body, headers = {}) =>
  api(`/api/tabs/${tabId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

await page.goto(`${BASE}/register`);
const replayMode = await api("/api/verify/replay-mode");
const replayModeBody = JSON.parse(replayMode.text || "{}");
check(
  "服务端确认 AI_MODE=replay",
  replayMode.status === 200 && replayModeBody.aiMode === "replay"
);
if (replayMode.status !== 200 || replayModeBody.aiMode !== "replay") {
  await browser.close();
  await mongoose.disconnect();
  process.exit(1);
}

const sendNaturalMessage = async (workRecordId, tabId, content) => {
  const tab = await tabById(workRecordId, tabId);
  const result = await postChat(tabId, {
    content,
    requestId: `natural-${Date.now()}-${Math.random()}`,
    expectedVersion: tab.version,
  });
  if (result.status !== 200) throw new Error("自然语言消息发送失败");
  return waitForTab(workRecordId, tabId, (next) => next.version === tab.version + 2);
};

const messageIdFromSse = (text) =>
  text.match(/"messageId":"([0-9a-f]{24})"/)?.[1] ?? null;

const generatedDocumentContent = (content, filename) => {
  const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(
      `%%%FILE_BEGIN%%%\\s*${escapedFilename}\\s*\\n([\\s\\S]*?)%%%FILE_END%%%`
    )
  );
  return match?.[1].trim() ?? null;
};

// 建立登录工作台。
const email = `verify-explicit-freeze-${Date.now()}@test.local`;
const password = "verify-pass-1234";
await page.goto(`${BASE}/register`);
await page.fill("#email", email);
await page.locator('input[type="password"]').first().fill(password);
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
await page.fill('input[placeholder="输入项目名称"]', "显式冻结协议回放验证");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /显式冻结协议回放验证/ }).click();
await page.waitForURL((url) => /\/projects\/[0-9a-f]{24}$/.test(url.pathname));
const projectId = page.url().split("/").pop();
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await page.getByRole("button", { name: "创建", exact: true }).click();
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((url) => url.pathname.startsWith("/workspace/"));
const workRecordId = page.url().split("/").pop();

const createTab = async (agentType) => {
  const result = await api(`/api/work-records/${workRecordId}/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_type: agentType }),
  });
  if (result.status !== 201) throw new Error(`无法创建 ${agentType} tab`);
  return JSON.parse(result.text).tab;
};

const prdTab = await createTab("mvp_prd");
const prototypeTab = await createTab("prototype");

console.log("\n#09 显式范围冻结协议");

await sendNaturalMessage(workRecordId, prdTab.id, "确认，范围就这样");
const afterPositive = await tabById(workRecordId, prdTab.id);
check(
  "肯定自然语言不会直接正式冻结",
  afterPositive.scope_frozen === false && afterPositive.freeze_status === "idle"
);
await sendNaturalMessage(workRecordId, prdTab.id, "我不同意冻结，请保留当前版本");
const proposedPrd = await waitForTab(
  workRecordId,
  prdTab.id,
  (tab) => tab.freeze_status === "proposed"
);
check(
  "Agent 提议冻结只进入 proposed，历史与否定句不触发冻结",
  proposedPrd.scope_frozen === false && proposedPrd.freeze_status === "proposed"
);

await page.evaluate(
  ({ key, tabId }) => localStorage.setItem(key, tabId),
  { key: `pm-assistant-active-tab:${workRecordId}`, tabId: prdTab.id }
);
await page.reload();
await page.waitForLoadState("networkidle");
check(
  "刷新后服务端 proposed 状态恢复为明确控件",
  await page.getByRole("button", { name: "确认冻结" }).isVisible()
);

await page.evaluate(() => {
  window.__verifyFreezeSlow = true;
});
await page.getByRole("button", { name: "确认冻结" }).click();
const freezeProcessing = page.getByText("冻结处理中", { exact: true });
await freezeProcessing.waitFor({ state: "visible" });
check(
  "点击控件后显示冻结处理中",
  await freezeProcessing.isVisible()
);
const duplicateBody = await page.evaluate(() => window.__verifyFreezeRequests.at(-1));
await page.reload();
await page.waitForLoadState("networkidle");
const awaitingWritePrd = await waitForTab(
  workRecordId,
  prdTab.id,
  (tab) => tab.freeze_status === "awaiting_write"
);
await page.getByRole("dialog").filter({ hasText: "Agent 产出文件" }).waitFor({ state: "visible" });
check(
  "冻结处理中刷新后从服务端恢复待写入和确认弹窗",
  awaitingWritePrd.scope_frozen === false &&
    (await page.getByRole("dialog").filter({ hasText: "Agent 产出文件" }).isVisible())
);
const duplicateResponse = await postChat(prdTab.id, duplicateBody);
const duplicateAssistantCount = await Message.countDocuments({
  tab_id: new mongoose.Types.ObjectId(prdTab.id),
  request_id: duplicateBody.requestId,
});
check(
  "重复点击同一冻结 requestId 不重复生成",
  duplicateResponse.status === 200 && duplicateAssistantCount === 1
);
check(
  "生成文档后仍未正式冻结且出现写入确认",
  awaitingWritePrd.scope_frozen === false &&
    (await page.getByRole("dialog").filter({ hasText: "Agent 产出文件" }).isVisible())
);

await page.getByRole("button", { name: "全部丢弃" }).click();
const canceledPrd = await waitForTab(
  workRecordId,
  prdTab.id,
  (tab) => tab.freeze_status === "proposed"
);
const filesAfterCancel = await api(`/api/projects/${projectId}/files`);
check(
  "取消写入不落盘且不正式冻结",
  canceledPrd.scope_frozen === false &&
    !JSON.parse(filesAfterCancel.text).some((file) => file.filename.includes("概念版（"))
);

await page.evaluate(() => {
  window.__verifyFreezeSlow = false;
  window.__verifyFreezeError = true;
});
await page.getByRole("button", { name: "确认冻结" }).click();
const failedPrd = await waitForTab(
  workRecordId,
  prdTab.id,
  (tab) => tab.freeze_status === "failed"
);
check(
  "文档生成失败不会正式冻结，并保留可重试状态",
  failedPrd.scope_frozen === false &&
    (await page.getByRole("button", { name: "重新生成冻结文档" }).isVisible())
);

await page.evaluate(() => {
  window.__verifyFreezeError = false;
});
await page.getByRole("button", { name: "重新生成冻结文档" }).click();
await waitForTab(workRecordId, prdTab.id, (tab) => tab.freeze_status === "awaiting_write");
await page.getByRole("dialog").filter({ hasText: "Agent 产出文件" }).waitFor({ state: "visible" });
await page.evaluate(() => {
  window.__verifyFreezeWriteFailure = true;
});
await page.getByRole("button", { name: /批量写入/ }).click();
const writeFailedPrd = await tabById(workRecordId, prdTab.id);
check(
  "文件写入失败不会正式冻结",
  writeFailedPrd.scope_frozen === false && writeFailedPrd.freeze_status === "awaiting_write"
);

await page.evaluate(() => {
  window.__verifyFreezeWriteFailure = false;
});
const prdFileDialog = page
  .getByRole("dialog")
  .filter({ hasText: "Agent 产出文件" });
await page.evaluate((replacement) => {
  window.__verifyFreezeReplaceBeforeComplete = replacement;
}, {
  projectId,
  filename: `概念版（${prdTab.display_name}）.md`,
  content: "# 概念版\n\n同名但不属于本轮的错误正文",
  agentType: "mvp_prd",
});
await page.getByRole("button", { name: /批量写入/ }).click();
await page
  .waitForFunction(
    () => window.__verifyFreezeCompleteResults.length > 0,
    undefined,
    { timeout: 3_000 }
  )
  .catch(() => null);
const afterMismatchedPrd = await waitForTab(
  workRecordId,
  prdTab.id,
  (tab) => tab.freeze_status === "awaiting_write"
);
const mismatchComplete = await page.evaluate(
  () => window.__verifyFreezeCompleteResults.at(-1)
);
const mismatchPayload = mismatchComplete
  ? JSON.parse(mismatchComplete.response.text)
  : null;
await page.reload();
await page.waitForLoadState("networkidle");
await prdFileDialog.waitFor({ state: "visible" });
const mismatchDialogVisible = await prdFileDialog.isVisible();
const mismatchRecoveryReady =
  mismatchComplete?.replacementStatus === 201 &&
  mismatchComplete.response.status === 409 &&
  mismatchPayload?.error === "冻结文档内容与本次生成结果不一致" &&
  afterMismatchedPrd.scope_frozen === false &&
  mismatchPayload?.tabVersion === afterMismatchedPrd.version &&
  mismatchDialogVisible;
check(
  "摘要不匹配后刷新仍显示可重试的写入确认并同步版本",
  mismatchRecoveryReady,
  JSON.stringify({
    replacementStatus: mismatchComplete?.replacementStatus,
    completeStatus: mismatchComplete?.response.status,
    error: mismatchPayload?.error,
    responseTabVersion: mismatchPayload?.tabVersion,
    persistedTabVersion: afterMismatchedPrd.version,
    dialogVisible: mismatchDialogVisible,
    freezeRequests: await page.evaluate(() => window.__verifyFreezeRequests),
    fileWrites: await page.evaluate(() => window.__verifyFreezeFileWrites),
  })
);
if (mismatchRecoveryReady) {
  await page.getByRole("button", { name: /批量写入/ }).click();
}
const frozenPrd = mismatchRecoveryReady
  ? await waitForTab(
      workRecordId,
      prdTab.id,
      (tab) => tab.freeze_status === "frozen"
    )
  : await tabById(workRecordId, prdTab.id);
check(
  "恢复确认后会用新版本重写本轮正文并正式冻结",
  mismatchRecoveryReady &&
    frozenPrd.scope_frozen === true &&
    frozenPrd.freeze_status === "frozen"
);
const overwriteFrozenPrd = await api(`/api/projects/${projectId}/files`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    filename: `概念版（${prdTab.display_name}）.md`,
    content: "# 概念版\n\n不应覆盖正式冻结的正文",
    agent_type: "mvp_prd",
  }),
});
const frozenPrdFile = JSON.parse(
  (await api(`/api/projects/${projectId}/files`)).text
).find((file) => file.filename === `概念版（${prdTab.display_name}）.md`);
const patchFrozenPrd = frozenPrdFile
  ? await api(`/api/projects/${projectId}/files/${frozenPrdFile.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# 概念版\n\n不应通过 PATCH 覆盖" }),
    })
  : { status: 0 };
const deleteFrozenPrd = frozenPrdFile
  ? await api(`/api/projects/${projectId}/files/${frozenPrdFile.id}`, {
      method: "DELETE",
    })
  : { status: 0 };
check(
  "正式冻结后文件接口拒绝 POST/PATCH/DELETE 操作已绑定的冻结文档",
  overwriteFrozenPrd.status === 409 &&
    patchFrozenPrd.status === 409 &&
    deleteFrozenPrd.status === 409 &&
    (await tabById(workRecordId, prdTab.id)).scope_frozen === true
);
await page.reload();
await page.waitForLoadState("networkidle");
check(
  "刷新后正式冻结状态保持一致",
  await page.getByText("范围已正式冻结", { exact: true }).isVisible()
);

await sendNaturalMessage(workRecordId, prototypeTab.id, "完满");
await sendNaturalMessage(workRecordId, prototypeTab.id, "我不确认，先保留方案");
const proposedPrototype = await waitForTab(
  workRecordId,
  prototypeTab.id,
  (tab) => tab.freeze_status === "proposed"
);
const prototypeFreeze = await postChat(prototypeTab.id, {
  freeze: true,
  requestId: `prototype-freeze-${Date.now()}`,
  expectedVersion: proposedPrototype.version,
});
const prototypeMessageId = messageIdFromSse(prototypeFreeze.text);
const awaitingPrototype = await waitForTab(
  workRecordId,
  prototypeTab.id,
  (tab) => tab.freeze_status === "awaiting_write"
);
check(
  "原型 Agent 同样只由显式操作进入待写入状态",
  prototypeFreeze.status === 200 &&
    Boolean(prototypeMessageId) &&
    awaitingPrototype.scope_frozen === false
);
const mismatchedWritePrototype = await api(`/api/projects/${projectId}/files`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    filename: "原型.md",
    content: "# 原型\n\n冻结回放文档",
    agent_type: "prototype",
  }),
});
const mismatchedCompletePrototype = await api(`/api/tabs/${prototypeTab.id}/freeze`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "complete",
    requestId: `prototype-complete-${Date.now()}`,
    expectedVersion: awaitingPrototype.version,
  }),
});
const afterMismatchedPrototype = await waitForTab(
  workRecordId,
  prototypeTab.id,
  (tab) => tab.freeze_status === "awaiting_write"
);
const generatedPrototypeMessage = prototypeMessageId
  ? await Message.collection.findOne({
      _id: new mongoose.Types.ObjectId(prototypeMessageId),
    })
  : null;
const matchingPrototypeContent =
  typeof generatedPrototypeMessage?.content === "string"
    ? generatedDocumentContent(generatedPrototypeMessage.content, "原型.md")
    : null;
check(
  "同名但非本轮生成的文档不能正式冻结",
  mismatchedWritePrototype.status === 201 &&
    mismatchedCompletePrototype.status === 409 &&
    JSON.parse(mismatchedCompletePrototype.text).error ===
      "冻结文档内容与本次生成结果不一致" &&
    afterMismatchedPrototype.scope_frozen === false
);
const matchingWritePrototype = await api(`/api/projects/${projectId}/files`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    filename: "原型.md",
    content: matchingPrototypeContent ?? "",
    agent_type: "prototype",
  }),
});
const completePrototype = await api(`/api/tabs/${prototypeTab.id}/freeze`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "complete",
    requestId: `prototype-complete-matching-${Date.now()}`,
    expectedVersion: afterMismatchedPrototype.version,
  }),
});
const frozenPrototype = await waitForTab(
  workRecordId,
  prototypeTab.id,
  (tab) => tab.freeze_status === "frozen"
);
check(
  "本轮原型文档写入成功后才正式冻结",
  Boolean(matchingPrototypeContent) &&
    [200, 201].includes(matchingWritePrototype.status) &&
    completePrototype.status === 200 &&
    frozenPrototype.scope_frozen === true
);

const raceTab = await createTab("mvp_prd");
await sendNaturalMessage(workRecordId, raceTab.id, "范围已经足够，请给出冻结建议");
await sendNaturalMessage(workRecordId, raceTab.id, "先不确认，请保留当前范围");
const proposedRace = await waitForTab(
  workRecordId,
  raceTab.id,
  (tab) => tab.freeze_status === "proposed"
);
const raceFreeze = await postChat(raceTab.id, {
  freeze: true,
  requestId: `race-freeze-${Date.now()}`,
  expectedVersion: proposedRace.version,
});
const raceMessageId = messageIdFromSse(raceFreeze.text);
const awaitingRace = await waitForTab(
  workRecordId,
  raceTab.id,
  (tab) => tab.freeze_status === "awaiting_write"
);
const generatedRaceMessage = raceMessageId
  ? await Message.collection.findOne({
      _id: new mongoose.Types.ObjectId(raceMessageId),
    })
  : null;
const raceFilename = `概念版（${raceTab.display_name}）.md`;
const matchingRaceContent =
  typeof generatedRaceMessage?.content === "string"
    ? generatedDocumentContent(generatedRaceMessage.content, raceFilename)
    : null;
const matchingRaceWrite = await api(`/api/projects/${projectId}/files`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    filename: raceFilename,
    content: matchingRaceContent ?? "",
    agent_type: "mvp_prd",
  }),
});
const [raceComplete, raceOverwrite] = await Promise.all([
  api(`/api/tabs/${raceTab.id}/freeze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "complete",
      requestId: `race-complete-${Date.now()}`,
      expectedVersion: awaitingRace.version,
    }),
  }),
  api(`/api/projects/${projectId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: raceFilename,
      content: "# 概念版\n\n并发覆盖的错误正文",
      agent_type: "mvp_prd",
    }),
  }),
]);
const raceFinalTab = await waitForTab(
  workRecordId,
  raceTab.id,
  (tab) => tab.version === awaitingRace.version + 2
);
const raceFiles = JSON.parse((await api(`/api/projects/${projectId}/files`)).text);
const raceFile = raceFiles.find((file) => file.filename === raceFilename);
const raceFileContent = raceFile
  ? JSON.parse(
      (await api(`/api/projects/${projectId}/files/${raceFile.id}`)).text
    ).content
  : "";
check(
  "冻结完成与并发文件覆盖不会留下正文不一致的正式冻结",
  Boolean(matchingRaceContent) &&
    matchingRaceWrite.status === 201 &&
    ((raceComplete.status === 200 &&
      raceOverwrite.status === 409 &&
      raceFinalTab.scope_frozen === true &&
      !raceFileContent.includes("并发覆盖的错误正文")) ||
      (raceComplete.status === 409 &&
        raceOverwrite.status === 201 &&
        raceFinalTab.scope_frozen === false))
);

await browser.close();
await mongoose.disconnect();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
