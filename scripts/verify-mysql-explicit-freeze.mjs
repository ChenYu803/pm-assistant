// v1.3 #05 固定回放：MySQL 显式冻结两阶段、绑定与文件锁定。
// 用法：AI_MODE=replay npm run verify:mysql-explicit-freeze
// 前置：dev server 运行，已执行 db:init；禁止使用 AI_MODE=live。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";

if (process.env.AI_MODE === "live") {
  console.error("❌ 验证拒绝 AI_MODE=live；请使用 AI_MODE=replay");
  process.exit(1);
}

nextEnv.loadEnvConfig(process.cwd());
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const email = `verify-freeze-${Date.now()}@test.local`;
const password = "verify-pass-1234";
let pass = 0;
let fail = 0;

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? `：${detail}` : ""}`);
  }
}

async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { path, init });
}

async function chat(page, tabId, body, headers = {}) {
  return page.evaluate(async ({ tabId, body, headers }) => {
    const response = await fetch(`/api/tabs/${tabId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return {
      status: response.status,
      events: text.split("\n\n").filter(Boolean).map((event) => JSON.parse(event.replace(/^data: /, ""))),
    };
  }, { tabId, body, headers });
}

async function createMvpTab(page) {
  const project = await api(page, "/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "冻结验证项目" }) });
  const workRecord = await api(page, `/api/projects/${project.body.id}/work-records`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "未命名" }) });
  const tab = await api(page, `/api/work-records/${workRecord.body.id}/tabs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_type: "mvp_prd" }) });
  return { projectId: project.body.id, tabId: tab.body.id, ok: project.status === 201 && workRecord.status === 201 && tab.status === 201 };
}

async function createPrototypeTab(page, projectId) {
  const workRecord = await api(page, `/api/projects/${projectId}/work-records`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "原型冻结验证" }) });
  const tab = await api(page, `/api/work-records/${workRecord.body.id}/tabs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_type: "prototype" }) });
  return { tabId: tab.body.id, ok: workRecord.status === 201 && tab.status === 201 };
}

async function propose(page, tabId, version = 0) {
  const first = await chat(page, tabId, { content: "请开始整理范围", requestId: `freeze-first-${Date.now()}`, expectedVersion: version });
  const firstVersion = first.events.find((event) => event.type === "done")?.tabVersion;
  const second = await chat(page, tabId, { content: "请给出范围方案", requestId: `freeze-proposal-${Date.now()}`, expectedVersion: firstVersion });
  return second;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
let connection;
try {
  await page.goto(`${BASE}/register`);
  await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");

  const setup = await createMvpTab(page);
  check("MySQL 冻结验证工作区创建成功", setup.ok);
  const proposal = await propose(page, setup.tabId);
  const proposalDone = proposal.events.find((event) => event.type === "done");
  check("当前轮提议标记才进入 proposed", proposal.status === 200 && proposalDone?.freezeStatus === "proposed");

  const proposedState = await api(page, `/api/tabs/${setup.tabId}/messages`);
  const negative = await chat(page, setup.tabId, { content: "不冻结，继续讨论", requestId: `freeze-negative-${Date.now()}`, expectedVersion: proposedState.body.tabVersion });
  const afterNegative = await api(page, `/api/tabs/${setup.tabId}/messages`);
  check("否定句不会触发冻结", negative.status === 200 && afterNegative.body.scopeFrozen === false && afterNegative.body.freezeStatus === "proposed");

  const failed = await chat(page, setup.tabId, { freeze: true, requestId: `freeze-failed-${Date.now()}`, expectedVersion: afterNegative.body.tabVersion }, { "x-pm-verify-force-error": "zero-token" });
  const failedEvent = failed.events.find((event) => event.type === "error");
  const afterFailed = await api(page, `/api/tabs/${setup.tabId}/messages`);
  check("冻结生成失败可恢复为 failed", failed.status === 200 && failedEvent?.freezeStatus === "failed" && afterFailed.body.freezeStatus === "failed" && afterFailed.body.scopeFrozen === false);

  const firstFreezeId = `freeze-generate-${Date.now()}`;
  const [generated, retried] = await Promise.all([0, 1].map(() => chat(page, setup.tabId, { freeze: true, requestId: firstFreezeId, expectedVersion: afterFailed.body.tabVersion })));
  const generatedDone = generated.events.find((event) => event.type === "done") ?? retried.events.find((event) => event.type === "done");
  const afterGenerated = await api(page, `/api/tabs/${setup.tabId}/messages`);
  check("重复冻结请求只生成一条待写入消息", [generated, retried].every((result) => result.status === 200) && generatedDone?.freezeStatus === "awaiting_write" && afterGenerated.body.freezeStatus === "awaiting_write" && afterGenerated.body.messages.filter((message) => message.id === generatedDone?.messageId).length === 1);

  await page.reload();
  const afterReload = await api(page, `/api/tabs/${setup.tabId}/messages`);
  check("刷新后恢复待写入冻结状态", afterReload.status === 200 && afterReload.body.freezeStatus === "awaiting_write" && afterReload.body.freezeMessageId === generatedDone?.messageId);

  const wrongComplete = await api(page, `/api/tabs/${setup.tabId}/freeze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete", requestId: `freeze-missing-${Date.now()}`, expectedVersion: afterGenerated.body.tabVersion }) });
  const rejectedWrite = await api(page, `/api/projects/${setup.projectId}/files`, { method: "POST", headers: { "Content-Type": "application/json", "x-pm-verify-mysql-write-fail": "1" }, body: JSON.stringify({ filename: "概念版（MVP PRD #1）.md", content: "拒绝写入", agent_type: "mvp_prd", source_message_id: generatedDone?.messageId }) });
  const afterMissing = await api(page, `/api/tabs/${setup.tabId}/messages`);
  check("未写入或真实写入失败不能正式冻结", wrongComplete.status === 409 && rejectedWrite.status === 500 && afterMissing.body.freezeStatus === "awaiting_write" && afterMissing.body.scopeFrozen === false);

  const cancelRequestId = `freeze-cancel-${Date.now()}`;
  const cancelled = await api(page, `/api/tabs/${setup.tabId}/freeze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", requestId: cancelRequestId, expectedVersion: afterMissing.body.tabVersion }) });
  const repeatedCancel = await api(page, `/api/tabs/${setup.tabId}/freeze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", requestId: cancelRequestId, expectedVersion: afterMissing.body.tabVersion }) });
  check("取消待写入冻结可幂等回放", cancelled.status === 200 && repeatedCancel.status === 200 && cancelled.body.freezeStatus === "proposed" && repeatedCancel.body.freezeStatus === "proposed" && cancelled.body.scopeFrozen === false);

  const afterCancel = await api(page, `/api/tabs/${setup.tabId}/messages`);
  const secondFreeze = await chat(page, setup.tabId, { freeze: true, requestId: `freeze-generate-final-${Date.now()}`, expectedVersion: afterCancel.body.tabVersion });
  const finalAssistant = secondFreeze.events.find((event) => event.type === "done");
  const afterFinalGenerate = await api(page, `/api/tabs/${setup.tabId}/messages`);
  const concept = "# 概念版\n\n核心用户：公司员工；要解决的一件事：减少午餐排队时间；产品形态：Web 应用；MVP 功能：菜品浏览、购物车、提交订单、订单状态；本版本不做在线支付和外卖配送；商业模式：免费使用；外部依赖声明：无。";
  const filename = "概念版（MVP PRD #1）.md";
  const write = await api(page, `/api/projects/${setup.projectId}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename, content: concept, agent_type: "mvp_prd", source_message_id: finalAssistant?.messageId }) });
  const completeRequestId = `freeze-complete-${Date.now()}`;
  const complete = await api(page, `/api/tabs/${setup.tabId}/freeze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete", requestId: completeRequestId, expectedVersion: afterFinalGenerate.body.tabVersion }) });
  const repeatedComplete = await api(page, `/api/tabs/${setup.tabId}/freeze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete", requestId: completeRequestId, expectedVersion: afterFinalGenerate.body.tabVersion }) });
  const lockedPatch = write.body ? await api(page, `/api/projects/${setup.projectId}/files/${write.body.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "错误覆盖" }) }) : { status: 0 };
  check("正确文档写入后原子绑定、幂等冻结并锁定", write.status === 201 && complete.status === 200 && repeatedComplete.status === 200 && complete.body.freezeStatus === "frozen" && repeatedComplete.body.freezeStatus === "frozen" && lockedPatch.status === 409);

  const prototype = await createPrototypeTab(page, setup.projectId);
  const prototypeProposal = await propose(page, prototype.tabId);
  const prototypeState = await api(page, `/api/tabs/${prototype.tabId}/messages`);
  const prototypeGenerated = await chat(page, prototype.tabId, { freeze: true, requestId: `prototype-freeze-${Date.now()}`, expectedVersion: prototypeState.body.tabVersion });
  const prototypeAssistant = prototypeGenerated.events.find((event) => event.type === "done");
  const prototypeContent = "# 原型\n\n## 商品浏览页\n- **目的**：让学生浏览和搜索二手商品。\n- **元素**：搜索框（显示文案「搜索商品」）、商品列表、分类筛选、商品卡片（显示文案「查看详情」）。\n- **操作**：输入关键词后过滤列表；点击商品卡片进入详情。\n- **入口·出口**：从首页进入；可进入商品详情页。\n- **依赖**：商品数据、分类数据。\n\n## 用户流程：发布商品\n- **触发**：学生决定出售闲置物品。\n- **主路径**：填写标题、描述和价格 → 上传图片 → 点击「发布」→ 展示发布成功。\n- **异常分支**：必填项为空时提示并停留在表单页。\n- **边界情况**：图片格式不支持时提示重新选择。";
  const prototypeWrite = await api(page, `/api/projects/${setup.projectId}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "原型.md", content: prototypeContent, agent_type: "prototype", source_message_id: prototypeAssistant?.messageId }) });
  const prototypeComplete = await api(page, `/api/tabs/${prototype.tabId}/freeze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete", requestId: `prototype-complete-${Date.now()}`, expectedVersion: (await api(page, `/api/tabs/${prototype.tabId}/messages`)).body.tabVersion }) });
  check("原型 tab 同样完成显式冻结", prototype.ok && prototypeProposal.events.some((event) => event.freezeStatus === "proposed") && prototypeGenerated.events.some((event) => event.freezeStatus === "awaiting_write") && prototypeWrite.status === 201 && prototypeComplete.status === 200 && prototypeComplete.body.freezeStatus === "frozen");

  connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
  const [rows] = await connection.query("SELECT scope_frozen, freeze_status, freeze_binding_tab_id FROM tabs t JOIN work_records w ON w.id = t.work_record_id JOIN project_files f ON f.project_id = w.project_id AND f.filename = ? WHERE t.id = ?", [filename, setup.tabId]);
  check("MySQL 持久化冻结状态与文件绑定", rows[0]?.scope_frozen === 1 && rows[0]?.freeze_status === "frozen" && rows[0]?.freeze_binding_tab_id === setup.tabId);
} finally {
  await connection?.end();
  await context.close();
  await browser.close();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
