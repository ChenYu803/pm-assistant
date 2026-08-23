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
    headers: {
      "Content-Type": "application/json",
      "x-pm-assistant-test-system-write": "1",
    },
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

async function waitForDatabase(predicate, description) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`等待超时：${description}`);
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

  const deletionGate = await createTopology("删除闸门");
  await Project.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(deletionGate.projectId) },
    { $set: { deletion_state: "deleting" } }
  );
  const blockedWorkRecord = await createWorkRecord(
    deletionGate.projectId,
    "删除期间不应创建"
  );
  const blockedTab = await createTab(deletionGate.workRecordIds[0]);
  const blockedContext = await api(`/api/tabs/${deletionGate.tabIds[0]}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: deletionGate.fileId }),
  });
  const blockedFile = await createProjectFile(deletionGate.projectId);
  const blockedSnapshot = await api(
    `/api/projects/${deletionGate.projectId}/snapshots`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "<main>删除期间不应保存</main>" }),
    }
  );
  check(
    "删除闸门拒绝新建工作记录、tab、上下文、文件和快照",
    [blockedWorkRecord, blockedTab, blockedContext, blockedFile, blockedSnapshot].every(
      (response) => response.status === 404
    )
  );
  await Project.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(deletionGate.projectId) },
    { $set: { deletion_state: "active" } }
  );
  const deletionGateCleanup = await api(`/api/projects/${deletionGate.projectId}`, {
    method: "DELETE",
  });
  check("解除删除闸门后可完成清理", deletionGateCleanup.status === 200);

  const inFlightWrite = await createTopology("写入收尾");
  const heldWorkRecordCreate = api(
    `/api/projects/${inFlightWrite.projectId}/work-records`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pm-assistant-test-write-lease-pause": "1",
      },
      body: JSON.stringify({ name: "删除前已取得写入许可" }),
    }
  );
  await waitForDatabase(async () => {
    const project = await Project.collection.findOne({
      _id: new mongoose.Types.ObjectId(inFlightWrite.projectId),
    });
    return project?.deletion_write_leases?.length === 1;
  }, "写入许可登记");
  const cookieHeader = (await page.context().cookies(BASE))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  const deleteDuringWrite = fetch(
    new URL(`/api/projects/${inFlightWrite.projectId}`, BASE),
    { method: "DELETE", headers: { Cookie: cookieHeader } }
  ).then(async (response) => {
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  });
  const deletionWaitStartedAt = Date.now();
  const [heldWorkRecordResult, deleteDuringWriteResult] = await Promise.all([
    heldWorkRecordCreate,
    deleteDuringWrite,
  ]);
  const deletionWaitMs = Date.now() - deletionWaitStartedAt;
  const afterInFlightWrite = await traceCounts(inFlightWrite);
  const residualWorkRecords = await WorkRecord.countDocuments({
    project_id: new mongoose.Types.ObjectId(inFlightWrite.projectId),
  });
  check(
    "删除等待已开始写入结束，再清理其新增记录",
      heldWorkRecordResult.status === 201 &&
      deleteDuringWriteResult.status === 200 &&
      deletionWaitMs >= 800 &&
      isFullyRemoved(afterInFlightWrite) &&
      residualWorkRecords === 0
  );

  const staleLease = await createTopology("过期许可");
  await Project.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(staleLease.projectId) },
    {
      $set: {
        deletion_write_leases: [
          { token: "abandoned-write", expires_at: new Date(Date.now() - 1_000) },
        ],
      },
    }
  );
  const staleLeaseDelete = await api(`/api/projects/${staleLease.projectId}`, {
    method: "DELETE",
  });
  const afterStaleLeaseDelete = await traceCounts(staleLease);
  check(
    "异常退出留下的过期写入许可不会阻塞补偿",
    staleLeaseDelete.status === 200 && isFullyRemoved(afterStaleLeaseDelete)
  );

  const eventualCleanup = await createTopology("最终清理");
  await Project.deleteOne({
    _id: new mongoose.Types.ObjectId(eventualCleanup.projectId),
  });
  const lateWorkRecord = await WorkRecord.create({
    project_id: new mongoose.Types.ObjectId(eventualCleanup.projectId),
  });
  const lateTab = await Tab.create({ work_record_id: lateWorkRecord._id });
  await Promise.all([
    Message.create({
      role: "user",
      content: "删除后才返回的消息",
      tab_id: lateTab._id,
      timestamp: new Date(),
    }),
    AgentFileContext.create({
      tab_id: lateTab._id,
      file_id: new mongoose.Types.ObjectId(eventualCleanup.fileId),
      loaded_at: new Date(),
    }),
    TabOperation.create({
      tab_id: lateTab._id,
      request_id: `late-write-${Date.now()}`,
      operation: "verify-eventual-cleanup",
      expected_version: 0,
      status: "completed",
      created_at: new Date(),
      updated_at: new Date(),
    }),
  ]);
  const projectListAfterLateWrite = await api("/api/projects", {
    headers: { "x-pm-assistant-test-force-orphan-cleanup": "1" },
  });
  const afterEventualCleanup = await traceCounts(eventualCleanup);
  const [lateWorkRecords, lateTabs, lateMessages, lateContexts, lateOperations] =
    await Promise.all([
      WorkRecord.countDocuments({ _id: lateWorkRecord._id }),
      Tab.countDocuments({ _id: lateTab._id }),
      Message.countDocuments({ tab_id: lateTab._id }),
      AgentFileContext.countDocuments({ tab_id: lateTab._id }),
      TabOperation.countDocuments({ tab_id: lateTab._id }),
    ]);
  check(
    "重新打开项目列表会清扫删除后迟到写入的残留",
    projectListAfterLateWrite.status === 200 &&
      isFullyRemoved(afterEventualCleanup) &&
      [lateWorkRecords, lateTabs, lateMessages, lateContexts, lateOperations].every(
        (count) => count === 0
      )
  );

  const directTabDelete = await createTopology("单删标签页");
  const directTabDeleteResult = await api(`/api/tabs/${directTabDelete.tabIds[0]}`, {
    method: "DELETE",
  });
  const afterDirectTabDelete = await traceCounts(directTabDelete);
  check(
    "单独删除标签页也清理操作记录",
    directTabDeleteResult.status === 200 &&
      afterDirectTabDelete.tabs === 0 &&
      afterDirectTabDelete.messages === 0 &&
      afterDirectTabDelete.contexts === 0 &&
      afterDirectTabDelete.operations === 0
  );
  await api(`/api/projects/${directTabDelete.projectId}`, { method: "DELETE" });

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

  const workRecordCompensation = await createTopology("工作记录补偿");
  const compensationWorkRecordId = workRecordCompensation.workRecordIds[0];
  const injectedWorkRecordFailure = await api(
    `/api/work-records/${compensationWorkRecordId}`,
    {
      method: "DELETE",
      headers: {
        "x-pm-assistant-test-force-compensation": "1",
        "x-pm-assistant-test-cascade-fail-after": "agent-file-contexts",
      },
    }
  );
  const afterWorkRecordFailure = await traceCounts(workRecordCompensation);
  const deletingWorkRecordList = await api(
    `/api/projects/${workRecordCompensation.projectId}/work-records`
  );
  const deletingWorkRecordRead = await api(
    `/api/work-records/${compensationWorkRecordId}`
  );
  check(
    "工作记录故障注入返回可重试失败结果",
    injectedWorkRecordFailure.status === 500 &&
      injectedWorkRecordFailure.body?.code === "CASCADE_DELETE_FAILED" &&
      afterWorkRecordFailure.workRecords === 1 &&
      afterWorkRecordFailure.contexts === 0
  );
  check(
    "删除中的工作记录在列表和单项读取中都按不存在处理",
    deletingWorkRecordList.status === 200 &&
      deletingWorkRecordList.body?.length === 0 &&
      deletingWorkRecordRead.status === 404
  );
  const workRecordCompensationRetry = await api(
    `/api/work-records/${compensationWorkRecordId}`,
    { method: "DELETE" }
  );
  const afterWorkRecordCompensationRetry = await traceCounts(
    workRecordCompensation
  );
  check(
    "工作记录重复请求完成无事务补偿",
    workRecordCompensationRetry.status === 200 &&
      workRecordCompensationRetry.body?.mode === "compensation"
  );
  check(
    "工作记录补偿重试清理下属数据并保留项目文件和快照",
    afterWorkRecordCompensationRetry.workRecords === 0 &&
      afterWorkRecordCompensationRetry.tabs === 0 &&
      afterWorkRecordCompensationRetry.messages === 0 &&
      afterWorkRecordCompensationRetry.contexts === 0 &&
      afterWorkRecordCompensationRetry.operations === 0 &&
      afterWorkRecordCompensationRetry.projects === 1 &&
      afterWorkRecordCompensationRetry.files === 1 &&
      afterWorkRecordCompensationRetry.snapshots === 1
  );
  await api(`/api/projects/${workRecordCompensation.projectId}`, {
    method: "DELETE",
  });

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
