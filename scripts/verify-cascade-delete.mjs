// v1.2 #04：项目与工作记录的物理级联删除、补偿重试与不存在语义。
// 用法：AI_MODE=replay CASCADE_DELETE_TEST_HOOKS=1 VERIFY_BASE_URL=http://localhost:3001 node scripts/verify-cascade-delete.mjs
// 前置：验证服务也必须以 AI_MODE=replay CASCADE_DELETE_TEST_HOOKS=1 启动，MongoDB 可连。
import { chromium } from "playwright-core";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

if (process.env.AI_MODE && process.env.AI_MODE !== "replay") {
  console.error("❌ #04 验证只允许 AI_MODE=replay");
  process.exit(1);
}
if (process.env.CASCADE_DELETE_TEST_HOOKS !== "1") {
  console.error("❌ #04 验证需要 CASCADE_DELETE_TEST_HOOKS=1");
  process.exit(1);
}

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

const Project = mongoose.model(
  "VCascadeProject",
  new mongoose.Schema({ user_id: mongoose.Schema.Types.ObjectId }),
  "projects"
);
const WorkRecord = mongoose.model(
  "VCascadeWorkRecord",
  new mongoose.Schema({ project_id: mongoose.Schema.Types.ObjectId }),
  "work_records"
);
const Tab = mongoose.model(
  "VCascadeTab",
  new mongoose.Schema({ work_record_id: mongoose.Schema.Types.ObjectId }),
  "tabs"
);
const Message = mongoose.model(
  "VCascadeMessage",
  new mongoose.Schema({ tab_id: mongoose.Schema.Types.ObjectId }),
  "messages"
);
const AgentFileContext = mongoose.model(
  "VCascadeAgentFileContext",
  new mongoose.Schema({
    tab_id: mongoose.Schema.Types.ObjectId,
    file_id: mongoose.Schema.Types.ObjectId,
  }),
  "agent_file_contexts"
);
const ProjectFile = mongoose.model(
  "VCascadeProjectFile",
  new mongoose.Schema({ project_id: mongoose.Schema.Types.ObjectId }),
  "project_files"
);
const PrototypeSnapshot = mongoose.model(
  "VCascadePrototypeSnapshot",
  new mongoose.Schema({ project_id: mongoose.Schema.Types.ObjectId }),
  "prototype_snapshots"
);
const TabOperation = mongoose.model(
  "VCascadeTabOperation",
  new mongoose.Schema({ tab_id: mongoose.Schema.Types.ObjectId }),
  "tab_operations"
);

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}${detail ? ` (${detail})` : ""}`);
  }
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

async function api(pathname, init) {
  return page.evaluate(
    async ({ pathname: requestPath, init: requestInit }) => {
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
    { pathname, init }
  );
}

async function createProject(name) {
  return api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

async function createWorkRecord(projectId, name) {
  return api(`/api/projects/${projectId}/work-records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

async function createTab(workRecordId) {
  return api(`/api/work-records/${workRecordId}/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_type: "requirement_analyst" }),
  });
}

async function createProjectFile(projectId) {
  return api(`/api/projects/${projectId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "需求分析.md",
      content: "## 1. 级联删除验证",
      agent_type: "requirement_analyst",
    }),
  });
}

async function createTopology(label, workRecordCount = 1) {
  const project = await createProject(`${label}-${Date.now()}`);
  const projectId = project.body?.id;
  const file = await createProjectFile(projectId);
  const fileId = file.body?.id;
  const workRecordIds = [];
  const tabIds = [];

  for (let index = 0; index < workRecordCount; index += 1) {
    const workRecord = await createWorkRecord(projectId, `${label} 工作记录 ${index + 1}`);
    const workRecordId = workRecord.body?.id;
    const tab = await createTab(workRecordId);
    const tabId = tab.body?.tab?.id;
    workRecordIds.push(workRecordId);
    tabIds.push(tabId);

    await Message.create({
      role: "user",
      content: `${label} 消息 ${index + 1}`,
      tab_id: new mongoose.Types.ObjectId(tabId),
      timestamp: new Date(),
    });
    await AgentFileContext.create({
      tab_id: new mongoose.Types.ObjectId(tabId),
      file_id: new mongoose.Types.ObjectId(fileId),
      loaded_at: new Date(),
    });
    await TabOperation.create({
      tab_id: new mongoose.Types.ObjectId(tabId),
      request_id: `${label}-${Date.now()}-${index}`,
      operation: "verify-cascade-delete",
      expected_version: 0,
      status: "completed",
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  await PrototypeSnapshot.create({
    project_id: new mongoose.Types.ObjectId(projectId),
    content: `<main>${label}</main>`,
    version: 1,
    created_at: new Date(),
  });

  return { project, projectId, fileId, workRecordIds, tabIds };
}

async function traceCounts({ projectId, workRecordIds, tabIds }) {
  const projectObjectId = new mongoose.Types.ObjectId(projectId);
  const workRecordObjectIds = workRecordIds.map((id) => new mongoose.Types.ObjectId(id));
  const tabObjectIds = tabIds.map((id) => new mongoose.Types.ObjectId(id));
  const [projects, workRecords, tabs, messages, contexts, files, snapshots, operations] = await Promise.all([
    Project.countDocuments({ _id: projectObjectId }),
    WorkRecord.countDocuments({ _id: { $in: workRecordObjectIds } }),
    Tab.countDocuments({ _id: { $in: tabObjectIds } }),
    Message.countDocuments({ tab_id: { $in: tabObjectIds } }),
    AgentFileContext.countDocuments({ tab_id: { $in: tabObjectIds } }),
    ProjectFile.countDocuments({ project_id: projectObjectId }),
    PrototypeSnapshot.countDocuments({ project_id: projectObjectId }),
    TabOperation.countDocuments({ tab_id: { $in: tabObjectIds } }),
  ]);
  return { projects, workRecords, tabs, messages, contexts, files, snapshots, operations };
}

function isFullyRemoved(counts) {
  return Object.values(counts).every((count) => count === 0);
}

try {
  await mongoose.connect(env.MONGODB_URI);

  const email = `verify-cascade-${Date.now()}@test.local`;
  await page.goto(`${BASE}/register`);
  await page.fill("#email", email);
  await page.fill('input[type="password"]', "verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes("/register"), { timeout: 15000 });
  if (page.url().includes("/login")) {
    await page.fill("#email", email);
    await page.fill("#password", "verify-pass-1234");
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
  }

  const replay = await api("/api/verify/replay-mode");
  check("服务端确认 AI_MODE=replay", replay.body?.aiMode === "replay");

  const compensation = await createTopology("补偿重试", 2);
  check(
    "补偿夹具创建成功",
    compensation.project.status === 201 &&
      compensation.workRecordIds.every(Boolean) &&
      compensation.tabIds.every(Boolean) &&
      Boolean(compensation.fileId)
  );
  const injectedFailure = await api(`/api/projects/${compensation.projectId}`, {
    method: "DELETE",
    headers: {
      "x-pm-assistant-test-force-compensation": "1",
      "x-pm-assistant-test-cascade-fail-after": "agent-file-contexts",
    },
  });
  const afterInjectedFailure = await traceCounts(compensation);
  check(
    "故障注入返回可重试失败结果",
    injectedFailure.status === 500 && injectedFailure.body?.code === "CASCADE_DELETE_FAILED"
  );
  check(
    "补偿中断后保留删除入口并已有部分清理",
    afterInjectedFailure.projects === 1 &&
      afterInjectedFailure.contexts === 0 &&
      afterInjectedFailure.tabs === compensation.tabIds.length
  );
  const compensationRetry = await api(`/api/projects/${compensation.projectId}`, {
    method: "DELETE",
  });
  const afterCompensationRetry = await traceCounts(compensation);
  check(
    "重复请求完成无事务补偿",
    compensationRetry.status === 200 && compensationRetry.body?.mode === "compensation"
  );
  check("项目补偿重试清理全部关联集合", isFullyRemoved(afterCompensationRetry));
  const repeatedProjectDelete = await api(`/api/projects/${compensation.projectId}`, {
    method: "DELETE",
  });
  check(
    "已删除项目重复请求返回一致不存在",
    repeatedProjectDelete.status === 404 && repeatedProjectDelete.body?.code === "RESOURCE_NOT_FOUND"
  );

  const workRecordCase = await createTopology("工作记录级联");
  const workRecordId = workRecordCase.workRecordIds[0];
  const deletedWorkRecord = await api(`/api/work-records/${workRecordId}`, {
    method: "DELETE",
  });
  const afterWorkRecordDelete = await traceCounts(workRecordCase);
  check("工作记录删除成功", deletedWorkRecord.status === 200);
  check(
    "工作记录只清理其 tab、消息、上下文与操作记录",
    afterWorkRecordDelete.workRecords === 0 &&
      afterWorkRecordDelete.tabs === 0 &&
      afterWorkRecordDelete.messages === 0 &&
      afterWorkRecordDelete.contexts === 0 &&
      afterWorkRecordDelete.operations === 0
  );
  check(
    "工作记录删除保留项目级文件和快照",
    afterWorkRecordDelete.projects === 1 &&
      afterWorkRecordDelete.files === 1 &&
      afterWorkRecordDelete.snapshots === 1
  );
  const repeatedWorkRecordDelete = await api(`/api/work-records/${workRecordId}`, {
    method: "DELETE",
  });
  check(
    "已删除工作记录重复请求返回一致不存在",
    repeatedWorkRecordDelete.status === 404 && repeatedWorkRecordDelete.body?.code === "RESOURCE_NOT_FOUND"
  );

  const transactionPath = await createTopology("事务路径");
  const transactionDelete = await api(`/api/projects/${transactionPath.projectId}`, {
    method: "DELETE",
  });
  const afterTransactionDelete = await traceCounts(transactionPath);
  check(
    "事务优先路径或不支持事务时补偿路径成功",
    transactionDelete.status === 200 &&
      ["transaction", "compensation"].includes(transactionDelete.body?.mode)
  );
  check("事务优先路径清理全部关联集合", isFullyRemoved(afterTransactionDelete));
} finally {
  await browser.close();
  await mongoose.disconnect();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
