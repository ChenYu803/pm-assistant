// v1.2 #11：ticket 契约、整套替换/另存、最大版本、选择与下载回放。
import { chromium } from "playwright-core";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.AI_MODE === "live") {
  console.error("❌ #11 验证拒绝 AI_MODE=live；请使用 AI_MODE=replay");
  process.exit(1);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const envRaw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  envRaw.split("\n").filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => { const index = line.indexOf("="); return [line.slice(0, index).trim(), line.slice(index + 1).trim()]; })
);
if (!env.MONGODB_URI) throw new Error("MONGODB_URI 缺失");

const Message = mongoose.model(
  "VTicketDeliveryMessage",
  new mongoose.Schema({ role: String, content: String, tab_id: mongoose.Schema.Types.ObjectId, status: String, file_provenance_version: Number, timestamp: Date }, { collection: "messages" })
);
const MessageFileWrite = mongoose.model(
  "VTicketDeliveryWrite",
  new mongoose.Schema({ message_id: mongoose.Schema.Types.ObjectId, project_id: mongoose.Schema.Types.ObjectId, filename: String, file_version: Number }, { collection: "message_file_writes" })
);

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`); }
  else { fail += 1; console.log(`  ❌ ${name}${detail ? ` (${detail})` : ""}`); }
};

await mongoose.connect(env.MONGODB_URI);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15_000);
const email = `verify-ticket-version-${Date.now()}@test.local`;
const password = "verify-pass-1234";

async function api(pathname, init) {
  return page.evaluate(async ({ pathname: requestPath, init: requestInit }) => {
    const response = await fetch(requestPath, requestInit);
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body, headers: Object.fromEntries(response.headers.entries()) };
  }, { pathname, init });
}

function candidate(prefix) {
  return [
    { filename: "issues/01-model.md", content: `# 01 — ${prefix} 数据模型\n\n**What to build:** 用户可以建立订单所需的数据。\n\n**Blocked by:** None — can start immediately\n\n## 验收标准\n- [ ] 当用户创建订单时，系统保存完整订单。` },
    { filename: "issues/02-order.md", content: `# 02 — ${prefix} 下单流程\n\n**What to build:** 用户可以提交购物车中的订单。\n\n**Blocked by:** #01 — ${prefix} 数据模型\n\n## 验收标准\n- [ ] 当购物车非空时，系统创建订单并展示详情。` },
  ];
}

try {
  await page.goto(`${BASE}/register`);
  await page.fill("#email", email);
  await page.fill('input[type="password"]', password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/register");
  if (page.url().includes("/login")) {
    await page.fill("#email", email); await page.fill("#password", password);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.includes("/login"));
  }
  const project = await api("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "ticket 版本交付验证" }) });
  const projectId = project.body?.id;
  const record = await api(`/api/projects/${projectId}/work-records`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "ticket 验证" }) });
  const tab = await api(`/api/work-records/${record.body?.id}/tabs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_type: "ticket_splitter" }) });
  const tabId = tab.body?.tab?.id;
  const workRecord = await page.evaluate(async (id) => (await fetch(`/api/work-records/${id}`)).json(), record.body?.id);
  const projectObjectId = new mongoose.Types.ObjectId(projectId);
  const tabObjectId = new mongoose.Types.ObjectId(tabId);
  const createSource = async (label) => Message.create({ role: "assistant", content: label, tab_id: tabObjectId, status: "completed", file_provenance_version: 1, timestamp: new Date() });
  const sourceA = await createSource("第一套候选");
  const sourceB = await createSource("第二套候选");
  const sourceC = await createSource("第三套候选");
  check("创建验证项目与 ticket_splitter 来源消息", project.status === 201 && record.status === 201 && tab.status === 201 && workRecord.project_id === projectId);

  const first = await api(`/api/projects/${projectId}/ticket-sets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "replace", source_message_id: sourceA._id.toString(), candidates: candidate("第一版") }) });
  check("产品 ticket 首次整套替换成功", first.status === 201 && first.body?.mode === "replace" && first.body?.version === 0 && first.body?.files?.length === 2);
  const firstFields = first.body?.files?.every((file) => !/Status|Implementation/.test(file.content ?? ""));
  check("产品 ticket 只保留交付字段，不含 Status/Implementation", firstFields === true);
  const writesA = await MessageFileWrite.countDocuments({ message_id: sourceA._id, project_id: projectObjectId });
  check("整套写入为每张 ticket 持久化消息来源", writesA === 2);

  const setsAfterReplace = await api(`/api/projects/${projectId}/ticket-sets`);
  check("版本列表从文件集合推导且当前为最大版本", setsAfterReplace.status === 200 && setsAfterReplace.body?.currentVersion === 0 && setsAfterReplace.body?.versions?.length === 1 && setsAfterReplace.body.versions[0].files.length === 2);
  const downloadRoot = await api(`/api/projects/${projectId}/ticket-sets/0/download`);
  check("下载按完整版本集合返回，不混入其他版本", downloadRoot.status === 200 && downloadRoot.body?.version === 0 && downloadRoot.body?.files?.length === 2 && downloadRoot.body.files.every((file) => file.filename.startsWith("issues/")));

  const saved = await api(`/api/projects/${projectId}/ticket-sets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "save", source_message_id: sourceB._id.toString(), candidates: candidate("第二版") }) });
  check("另存生成完整 issues/v1 版本并保留旧版本", saved.status === 201 && saved.body?.mode === "save" && saved.body?.version === 1 && saved.body?.files?.every((file) => file.filename.startsWith("issues/v1/")));
  const setsAfterSave = await api(`/api/projects/${projectId}/ticket-sets`);
  check("最大 vN 自动视为当前版本且不需 current 标记", setsAfterSave.body?.currentVersion === 1 && setsAfterSave.body?.versions?.map((version) => version.version).join(",") === "0,1" && setsAfterSave.body.versions.filter((version) => version.current).length === 1);
  const v1Download = await api(`/api/projects/${projectId}/ticket-sets/1/download`);
  check("选择/下载 v1 始终返回 v1 完整集合", v1Download.status === 200 && v1Download.body?.version === 1 && v1Download.body.files.length === 2 && v1Download.body.files.every((file) => file.filename.startsWith("issues/v1/")));

  const replaced = await api(`/api/projects/${projectId}/ticket-sets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "replace", source_message_id: sourceC._id.toString(), candidates: candidate("第三版") }) });
  const finalSets = await api(`/api/projects/${projectId}/ticket-sets`);
  check("替换以完整集合更新根 issues 且不删除旧 v1", replaced.status === 201 && finalSets.body?.currentVersion === 1 && finalSets.body.versions.length === 2 && finalSets.body.versions.find((version) => version.version === 0)?.files.length === 2);
  const mixed = await api(`/api/projects/${projectId}/ticket-sets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "save", source_message_id: sourceC._id.toString(), candidates: [{ ...candidate("第三版")[0], filename: "issues/01-model.md\nissues/v1/02-order.md" }] }) });
  check("混用不同版本路径的候选集合被拒绝", mixed.status === 400);
} finally {
  await browser.close();
  await mongoose.disconnect();
}
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
