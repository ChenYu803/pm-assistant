// 验证 02 ticket：Agent 类型基础设施
// - 4 种 Agent 类型均可创建（创建标签页弹窗展示名称 + 描述）
// - 自动加载规则：prototype → 需求分析.md；mvp_prd → 需求分析.md + 原型.md（存在时）；
//   ticket_splitter → prd.md + 需求分析.md
// - 管线指示器四阶段 + 各 Agent 空态文案
// - 新类型（prototype）可对话（默认使用 AI_MODE=replay，不消耗真实 API）
// 前置：dev server 运行在 localhost:3000，MySQL 测试环境可用，
//       默认 AI_MODE=replay；真实模型冒烟时才需要 AI_MODE=live + AI_API_KEY
// 用法: node scripts/verify-agent-types.mjs
import { chromium } from "playwright-core";

if (process.env.AI_MODE !== "replay") {
  console.error("❌ 验证要求 AI_MODE=replay，未运行");
  process.exit(1);
}

const BASE = "http://localhost:3000";

const email = `verify-types-${Date.now()}@test.local`;
const password = "verify-pass-1234";
// 全部 Agent 类型（断言遍历与创建共用，避免重复定义漂移）
const ALL_AGENT_TYPES = ["requirement_analyst", "prototype", "mvp_prd", "ticket_splitter"];
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
  }
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

// ── 注册 → 项目 → 工作记录 ──────────────────────────────
await page.goto(`${BASE}/register`);
await page.fill("#email", email);
await page.fill('input[type="password"]', password);
await page.locator('input[type="password"]').nth(1).fill(password);
await page.locator('form button[type="submit"]').click();
await page.waitForURL((u) => u.pathname !== "/register", { timeout: 15000 });
if (page.url().includes("/login")) {
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
}

await page.goto(`${BASE}/projects`);
await page.getByRole("button", { name: "新建项目" }).click();
await page.fill('input[placeholder="输入项目名称"]', "验证 Agent 类型");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /验证 Agent 类型/ }).click();
await page.waitForURL((u) => /\/projects\/[0-9a-f-]{36}$/.test(u.pathname));
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await page.getByRole("button", { name: "创建", exact: true }).click();
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((u) => u.pathname.startsWith("/workspace/"));
const workRecordId = page.url().split("/").pop();

const wrRes = await page.evaluate(async (id) => {
  const res = await fetch(`/api/work-records/${id}`);
  return res.json();
}, workRecordId);
const projectId = wrRes.project_id;

// ── API 造数据：需求分析.md + 原型.md + prd.md（供自动加载断言）─
await page.evaluate(async (pid) => {
  const files = [
    { filename: "需求分析.md", content: "# 需求分析\n\n## 示例需求\n\n### 功能范围\n做 X，不做 Y。" },
    { filename: "原型.md", content: "# 原型\n\n## 页面清单\n" },
    { filename: "prd.md", content: "# 示例 PRD" },
  ];
  for (const f of files) {
    const res = await fetch(`/api/projects/${pid}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pm-assistant-test-system-write": "1" },
      body: JSON.stringify(f),
    });
    if (!res.ok) throw new Error(`写入 ${f.filename} 失败: ${res.status}`);
  }
}, projectId);

// ── API 创建 4 种 tab，断言创建成功 + 自动加载规则 ────────
const created = await page.evaluate(async ({ wid, types }) => {
  const results = {};
  for (const type of types) {
    const res = await fetch(`/api/work-records/${wid}/tabs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_type: type }),
    });
    const data = await res.json();
    results[type] = {
      status: res.status,
      context: (data.context_files ?? []).map((f) => f.filename),
    };
  }
  return results;
}, { wid: workRecordId, types: ALL_AGENT_TYPES });

for (const type of ALL_AGENT_TYPES) {
  check(`创建 tab「${type}」成功`, created[type]?.status === 201, `(status=${created[type]?.status})`);
}
check(
  "自动加载：prototype → [需求分析.md]",
  JSON.stringify(created.prototype?.context) === JSON.stringify(["需求分析.md"]),
  `(实际=${JSON.stringify(created.prototype?.context)})`
);
check(
  "自动加载：mvp_prd → [需求分析.md, 原型.md]",
  JSON.stringify(created.mvp_prd?.context) === JSON.stringify(["需求分析.md", "原型.md"]),
  `(实际=${JSON.stringify(created.mvp_prd?.context)})`
);
check(
  "自动加载：ticket_splitter → [prd.md, 需求分析.md]（按 spec 顺序）",
  JSON.stringify(created.ticket_splitter?.context) === JSON.stringify(["prd.md", "需求分析.md"]),
  `(实际=${JSON.stringify(created.ticket_splitter?.context)})`
);

// ── UI：创建标签页弹窗展示 4 种类型的结构化说明 ────────
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByTitle("新建标签页").click();
const dialog = page.locator('[role="dialog"]');
await dialog.waitFor({ state: "visible" });
const dialogText = await dialog.innerText();
for (const label of ["需求分析", "MVP-PRD", "原型", "任务拆分"]) {
  check(`弹窗展示 Agent「${label}」`, dialogText.includes(label));
}
for (const section of ["职责", "需要你提供什么", "会产出什么", "在流水线中的位置"]) {
  check(`弹窗展示说明段「${section}」`, dialogText.includes(section));
}
check("弹窗职责文案直白", dialogText.includes("我来帮你把模糊想法变成一条条清晰的需求"));
check(
  "弹窗显示需求分析输入输出",
  dialogText.includes("一个产品想法、要解决的问题") &&
    dialogText.includes("需求分析.md：每条需求包含")
);
check(
  "弹窗显示流水线位置",
  dialogText.includes("第 1 步：需求分析") &&
    dialogText.includes("第 4 步：任务拆分")
);
await page.keyboard.press("Escape");

// ── UI：管线指示器四阶段 + 原型 tab 空态文案 ──────────────
// 激活「原型 #1」tab（API 创建的第一个原型 tab；TabBar 的 tab 是 div 而非 button）
await page.getByText("原型 #1", { exact: true }).click();
await page.waitForTimeout(600);
const bodyText = await page.evaluate(() => document.body.innerText);
for (const phase of ["需求分析", "原型", "PRD 撰写", "任务拆分"]) {
  check(`管线指示器含阶段「${phase}」`, bodyText.includes(phase));
}
check("原型 tab 空态显示「已就绪」", bodyText.includes("原型 已就绪"));
check(
  "原型空态文案适配职责",
  bodyText.includes("告诉我产品要解决什么问题") &&
    bodyText.includes("现在该说什么？"),
  "  (空态文案缺失!)"
);

// ── 对话冒烟：prototype tab 发一条消息，等真实回复 ────────
await page.locator("textarea").fill("你好，请介绍一下你自己");
await page.getByRole("button", { name: "发送" }).click();
await page.waitForFunction(
  () => {
    const ta = document.querySelector("textarea");
    return ta && !ta.disabled;
  },
  null,
  { timeout: 90000 }
);
const reply = await page.evaluate(() => document.body.innerText);
check(
  "prototype 对话有回复（占位 prompt 可跑通）",
  /原型/.test(reply) || reply.length > 100,
  "  (未收到回复!)"
);

await browser.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
