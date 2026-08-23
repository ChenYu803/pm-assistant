// v1.2 #10 固定回放：消息级文件来源、重生成一致性和历史兜底隔离。
// 用法：AI_MODE=replay node scripts/verify-message-file-provenance.mjs
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
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` ${detail}` : ""}`);
  }
};

await mongoose.connect(env.MONGODB_URI);
const Message = mongoose.model(
  "VMessageFileProvenance",
  new mongoose.Schema(
    {
      role: String,
      content: String,
      timestamp: Date,
      tab_id: mongoose.Schema.Types.ObjectId,
      status: String,
      file_provenance_version: Number,
    },
    { collection: "messages" }
  )
);
const MessageFileWrite = mongoose.model(
  "VMessageFileWrite",
  new mongoose.Schema(
    {
      message_id: mongoose.Schema.Types.ObjectId,
      tab_id: mongoose.Schema.Types.ObjectId,
      project_id: mongoose.Schema.Types.ObjectId,
      project_file_id: mongoose.Schema.Types.ObjectId,
      filename: String,
      operation: String,
      file_version: Number,
      message_status: String,
      write_status: String,
      written_at: Date,
    },
    { collection: "message_file_writes" }
  )
);
const ProjectFile = mongoose.model(
  "VMessageFileProvenanceProjectFile",
  new mongoose.Schema(
    {
      filename: String,
      content: String,
      project_id: mongoose.Schema.Types.ObjectId,
      version: Number,
      created_at: Date,
      updated_at: Date,
    },
    { collection: "project_files" }
  )
);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext();
const page = await context.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20_000);

const email = `verify-provenance-${Date.now()}@test.local`;
const password = "verify-pass-1234";
await page.goto(`${BASE}/register`);
await page.fill("#email", email);
await page.fill('input[type="password"]', password);
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
await page.fill('input[placeholder="输入项目名称"]', "消息来源验证");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /消息来源验证/ }).click();
await page.waitForURL((url) => /\/projects\/[0-9a-f]{24}$/.test(url.pathname));
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await page.getByRole("button", { name: "创建", exact: true }).click();
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((url) => url.pathname.startsWith("/workspace/"));
const workRecordId = page.url().split("/").pop();
await page.getByRole("button", { name: /需求分析/ }).first().click();
await page.waitForLoadState("networkidle");

const tabs = await page.evaluate(
  async (id) => (await fetch(`/api/work-records/${id}/tabs`)).json(),
  workRecordId
);
const tabId = tabs[0].id;
const workRecord = await page.evaluate(
  async (id) => (await fetch(`/api/work-records/${id}`)).json(),
  workRecordId
);
const projectId = workRecord.project_id;
const tabObjectId = new mongoose.Types.ObjectId(tabId);

async function readMessages() {
  return page.evaluate(
    async (id) => (await fetch(`/api/tabs/${id}/messages`)).json(),
    tabId
  );
}

async function writeFromMessage(messageId, filename, content, forceProvenanceFailure = false) {
  return page.evaluate(
    async ({ project, sourceMessageId, name, body, failProvenance }) => {
      const response = await fetch(`/api/projects/${project}/files`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(failProvenance
            ? { "x-pm-assistant-test-provenance-fail": "1" }
            : {}),
        },
        body: JSON.stringify({
          filename: name,
          content: body,
          agent_type: "requirement_analyst",
          source_message_id: sourceMessageId,
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    {
      project: projectId,
      sourceMessageId: messageId,
      name: filename,
      body: content,
      failProvenance: forceProvenanceFailure,
    }
  );
}

async function readFile(filename) {
  return page.evaluate(
    async ({ project, name }) => {
      const files = await fetch(`/api/projects/${project}/files`).then((res) => res.json());
      const file = files.find((item) => item.filename === name);
      return file
        ? fetch(`/api/projects/${project}/files/${file.id}`).then((res) => res.json())
        : null;
    },
    { project: projectId, name: filename }
  );
}

async function dismissFileDialog() {
  const dialog = page.getByRole("dialog").filter({ hasText: "Agent 产出文件" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "全部丢弃" }).click();
    await dialog.waitFor({ state: "hidden" });
  }
}

async function waitForRegeneration(previousId) {
  await page.waitForFunction(
    async ({ id, previous }) => {
      const data = await fetch(`/api/tabs/${id}/messages`).then((res) => res.json());
      const latest = data.messages.filter((message) => message.role === "assistant").at(-1);
      return latest && latest.id !== previous && latest.status === "completed";
    },
    { id: tabId, previous: previousId },
    { polling: "raf", timeout: 30_000 }
  );
  await page.waitForFunction(
    () => ![...document.querySelectorAll("button")].some((button) => button.textContent?.includes("停止生成")),
    undefined,
    { polling: "raf", timeout: 30_000 }
  );
}

async function createTrackedMessage(label, filename) {
  return Message.create({
    role: "assistant",
    content: `${label}\n\n%%%FILE_BEGIN%%% ${filename}\n# ${label}\n%%%FILE_END%%%`,
    tab_id: tabObjectId,
    status: "completed",
    file_provenance_version: 1,
    timestamp: new Date(),
  });
}

async function clearScenarioMessages() {
  const messages = await Message.find({ tab_id: tabObjectId }).select({ _id: 1 }).lean();
  const ids = messages.map((message) => message._id);
  await MessageFileWrite.deleteMany({ message_id: { $in: ids } });
  await Message.deleteMany({ _id: { $in: ids } });
}

try {
  // B 已写同名文件，A 从未写入；A 的新协议标记禁止按 B 的同名文件误判。
  const messageB = await createTrackedMessage("消息 B 已写入", "prd.md");
  const writeB = await writeFromMessage(messageB._id.toString(), "prd.md", "# B 的 PRD");
  const messageA = await createTrackedMessage("消息 A 未写入", "prd.md");
  check(
    "每次写入持久化消息、文件、操作、版本与完成状态",
    writeB.status === 201 &&
      writeB.body.messageFileWrite?.filename === "prd.md" &&
      writeB.body.messageFileWrite?.operation === "create" &&
      writeB.body.messageFileWrite?.fileVersion === 1 &&
      writeB.body.messageFileWrite?.messageStatus === "completed" &&
      writeB.body.messageFileWrite?.writeStatus === "written"
  );
  const failedSource = await createTrackedMessage("来源写入失败", "原型.md");
  const failedWrite = await writeFromMessage(
    failedSource._id.toString(),
    "原型.md",
    "# 不应落盘",
    true
  );
  const failedHistory = await readMessages();
  const failedMessage = failedHistory.messages.find(
    (message) => message.id === failedSource._id.toString()
  );
  check(
    "来源记录失败时不留下无追踪文件写入",
    failedWrite.status === 500 &&
      (await readFile("原型.md")) === null &&
      failedMessage?.fileProvenance?.writes?.length === 0
  );
  const untrackedWrite = await page.evaluate(
    async (project) => {
      const response = await fetch(`/api/projects/${project}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "原型.md",
          content: "# 没有来源",
          agent_type: "requirement_analyst",
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    projectId
  );
  check(
    "Agent 写入缺少来源消息会被拒绝",
    untrackedWrite.status === 400 &&
      untrackedWrite.body?.error?.includes("来源消息") &&
      (await readFile("原型.md")) === null
  );
  await page.reload();
  await page.waitForLoadState("networkidle");
  const initialDialog = page.getByRole("dialog").filter({ hasText: "Agent 产出文件" });
  await initialDialog.waitFor();
  check(
    "消息 A 未写入时不因消息 B 的同名文件跳过确认",
    (await initialDialog.getByText("prd.md").count()) === 1
  );
  await initialDialog.getByRole("button", { name: "全部丢弃" }).click();
  await initialDialog.waitFor({ state: "hidden" });
  check(
    "刷新后按精确来源恢复 B 的已写入状态",
    (await page.locator(`[data-message-id="${messageB._id}"]`).getByText("已写入项目文件").count()) === 1
  );

  await page.getByRole("button", { name: "重新输出" }).click();
  await waitForRegeneration(messageA._id.toString());
  await page.waitForTimeout(250);
  check(
    "重生成 A 不把 B 的同名文件误判为 A 已写入文件",
    (await page.getByText("已写入文件与新回复可能不同步").count()) === 0
  );
  await dismissFileDialog();
  await clearScenarioMessages();

  // 已写入的旧回复不再输出该文件时，提示用户，并验证更新分支写入新回复文件。
  const updateSource = await createTrackedMessage("更新来源", "prd.md");
  const updateWrite = await writeFromMessage(updateSource._id.toString(), "prd.md", "# 更新前 PRD");
  check("同一文件第二次写入记录 update 与递增版本", updateWrite.body.messageFileWrite?.operation === "update" && updateWrite.body.messageFileWrite?.fileVersion === 2);
  await page.reload();
  await page.waitForLoadState("networkidle");
  check(
    "精确来源已恢复时不重复弹出确认框",
    !(await page.getByRole("dialog").filter({ hasText: "Agent 产出文件" }).isVisible().catch(() => false))
  );
  await page.getByRole("button", { name: "重新输出" }).click();
  await waitForRegeneration(updateSource._id.toString());
  const consistencyDialog = page.getByRole("dialog").filter({ hasText: "已写入文件与新回复可能不同步" });
  await consistencyDialog.waitFor();
  check("重生成后旧文件缺失时显示不一致提示", (await consistencyDialog.getByText("prd.md").count()) === 1);
  await consistencyDialog.getByRole("button", { name: "更新文件" }).click();
  const updateDialog = page.getByRole("dialog").filter({ hasText: "Agent 产出文件" });
  await updateDialog.waitFor();
  await updateDialog.getByRole("button", { name: /批量写入/ }).click();
  await updateDialog.waitFor({ state: "hidden" });
  const afterUpdate = await readMessages();
  const updateResult = afterUpdate.messages.filter((message) => message.role === "assistant").at(-1);
  check(
    "选择更新后走既有确认流并记录新回复来源",
    updateResult?.fileProvenance?.writes?.some((write) => write.filename === "需求分析.md" && write.writeStatus === "written") === true
  );
  await clearScenarioMessages();

  // 保持不变只关闭提示，不能覆盖已经写入的文件。
  const keepSource = await createTrackedMessage("保持来源", "prd.md");
  await writeFromMessage(keepSource._id.toString(), "prd.md", "# 保持不变的 PRD");
  const fileBeforeKeep = await readFile("prd.md");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "重新输出" }).click();
  await waitForRegeneration(keepSource._id.toString());
  const keepDialog = page.getByRole("dialog").filter({ hasText: "已写入文件与新回复可能不同步" });
  await keepDialog.waitFor();
  await keepDialog.getByRole("button", { name: "保持不变" }).click();
  await keepDialog.waitFor({ state: "hidden" });
  await page.waitForTimeout(250);
  const fileAfterKeep = await readFile("prd.md");
  check(
    "选择保持不变不会覆盖旧文件或打开普通确认框",
    fileAfterKeep?.content === fileBeforeKeep?.content &&
      !(await page.getByRole("dialog").filter({ hasText: "Agent 产出文件" }).isVisible().catch(() => false))
  );
  await clearScenarioMessages();

  // 没有协议标记的历史消息可按文件名兼容；同名带标记新消息仍必须单独确认。
  const legacy = await Message.create({
    role: "assistant",
    content: "历史消息\n\n%%%FILE_BEGIN%%% 原型.md\n# 历史原型\n%%%FILE_END%%%",
    tab_id: tabObjectId,
    status: "completed",
    timestamp: new Date(),
  });
  // 升级前的历史文件没有来源记录，直接构造旧数据，不能绕过新 API 的来源约束。
  await ProjectFile.create({
    filename: "原型.md",
    content: "# 历史原型",
    project_id: new mongoose.Types.ObjectId(projectId),
    version: 1,
    created_at: new Date(),
    updated_at: new Date(),
  });
  const newSameName = await createTrackedMessage("新消息同名未写入", "原型.md");
  await page.reload();
  await page.waitForLoadState("networkidle");
  const fallbackDialog = page.getByRole("dialog").filter({ hasText: "Agent 产出文件" });
  await fallbackDialog.waitFor();
  const history = await readMessages();
  const legacyFromApi = history.messages.find((message) => message.id === legacy._id.toString());
  check(
    "旧数据缺少来源记录时仍按文件名兜底",
    legacyFromApi?.fileProvenance?.tracked === false &&
      legacyFromApi?.fileProvenance?.writes?.length === 0
  );
  check(
    "旧数据兜底不污染同名新消息",
    (await fallbackDialog.getByText("原型.md").count()) === 1
  );
  await fallbackDialog.getByRole("button", { name: "全部丢弃" }).click();
  await fallbackDialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "重新输出" }).click();
  await waitForRegeneration(newSameName._id.toString());
  await page.waitForTimeout(250);
  check(
    "新消息重生成继续使用精确来源而非历史文件名",
    (await page.getByText("已写入文件与新回复可能不同步").count()) === 0
  );
  await dismissFileDialog();
} finally {
  await browser.close();
  await mongoose.disconnect();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
