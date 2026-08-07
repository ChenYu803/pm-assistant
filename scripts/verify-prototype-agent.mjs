// 验证 04 ticket：原型 Agent 完整闭环
// - 原型 tab 创建时自动加载 需求分析.md（存在时）
// - 真实对话：提案式访谈（先给方案再问、每轮 1 方案）
// - 真实对话：HTML 快照（%%%HTML_BEGIN%%%/%%%HTML_END%%%）→ 前端「下载 HTML 原型」
//   按钮可下载（Blob，suggestedFilename 为 .html，内容为单文件 HTML）
// - 真实对话：用户指正 → Agent 修订 → 重新生成 HTML 快照（确认闭环）
// - 用户「完满」确认 → tab.scope_frozen = true → Agent 输出原型.md → 确认框 → 落盘
// - 原型.md 断言：五字段（目的/元素/操作/入口·出口/依赖）+ 用户流程 + 显示文案
// - 轻量检查（WARN 不 fail）：对话回复表格 ≤5 行（5×5）；每轮问号 ≤4
// 前置：dev server 运行在 localhost:3000，MongoDB 可连（.env.local 的 MONGODB_URI），
//       DEEPSEEK_API_KEY 有效（真实对话需要）
// 用法: node scripts/verify-prototype-agent.mjs
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";

const email = `verify-pt-${Date.now()}@test.local`;
const password = "verify-pass-1234";
const MAX_ROUNDS = 12; // 真实对话轮数上限（控制 token 消耗）
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
let warnCount = 0;
const warn = (name, detail = "") => {
  warnCount++;
  console.log(`  ⚠️ WARN ${name} ${detail}`);
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
await page.fill('input[placeholder="输入项目名称"]', "验证原型 Agent");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /验证原型 Agent/ }).click();
await page.waitForURL((u) => /\/projects\/[0-9a-f]{24}$/.test(u.pathname));
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await page.getByRole("button", { name: "确认创建" }).click();
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((u) => u.pathname.startsWith("/workspace/"));
const workRecordId = page.url().split("/").pop();

const wrRes = await page.evaluate(async (id) => {
  const res = await fetch(`/api/work-records/${id}`);
  return res.json();
}, workRecordId);
const projectId = wrRes.project_id;

// ── 直接用 API 写入 需求分析.md（省掉需求分析对话，原型环节是测试对象）──────
const reqContent =
  "## 商品发布\n\n" +
  "### 用户与场景\n" +
  "本校大学生，毕业季清理闲置、日常买卖二手书和生活用品，目前靠微信群发图卖二手，无检索无信用体系。\n\n" +
  "### 用户故事\n" +
  "作为卖家，我想发布二手商品，以便快速卖掉闲置；作为买家，我想检索和私聊卖家，以便完成交易。\n\n" +
  "### 功能范围\n" +
  "做 X：商品发布、分类浏览搜索、站内私聊、用户评价（发布与搜索为 P0）。不做 Y：不做物流配送（成本高且非二手交易核心）、不做担保交易（资金托管超出 MVP）。\n\n" +
  "### 成功指标\n" +
  "上线 1 个月内发布商品 100 件、完成交易 30 笔。\n\n" +
  "# 排除清单\n\n" +
  "- 物流配送 — 理由：成本高非核心，取舍阶段：强烈\n" +
  "- 担保交易 — 理由：资金托管超出 MVP，取舍阶段：真实";
const writeRes = await page.evaluate(async ({ pid, content }) => {
  const res = await fetch(`/api/projects/${pid}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: "需求分析.md", content, agent_type: "prototype" }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}, { pid: projectId, content: reqContent });
check("需求分析.md 已写入（前置准备）", writeRes.status === 200 || writeRes.status === 201, `(status=${writeRes.status})`);

// ── API 创建原型 tab，断言自动加载 需求分析.md ───────────
const created = await page.evaluate(async (wid) => {
  const res = await fetch(`/api/work-records/${wid}/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_type: "prototype" }),
  });
  const data = await res.json();
  return { status: res.status, tab: data.tab, context: (data.context_files ?? []).map((f) => f.filename) };
}, workRecordId);
check("创建原型 tab 成功", created.status === 201, `(status=${created.status})`);
const tabId = created.tab?.id ?? created.tab?._id;
check("拿到 tab id", !!tabId, `(实际=${JSON.stringify(created.tab)?.slice(0, 120)})`);
check(
  "原型 tab 自动加载 需求分析.md",
  (created.context ?? []).some((f) => f.includes("需求分析.md")),
  `(context=${JSON.stringify(created.context)})`
);

// 激活该 tab（API 创建的 tab 需先刷新页面；TabBar 的 tab 是 div 而非 button）
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByText("原型 #1", { exact: true }).first().click();
await page.waitForTimeout(600);

// ── 真实对话：提案 → 指正 → 修订 → 完满 ───────────────────
const OPENING =
  "请开始原型设计。\n" +
  "产品：校园二手交易平台（需求分析.md 已加载，请基于它）。\n" +
  "核心功能：商品发布、分类浏览搜索、站内私聊、用户评价；发布与搜索是 P0。\n" +
  "不做：物流配送、担保交易。\n" +
  "请先给出你的整体方案（页面清单 + 用户流程），并生成 HTML 原型快照。";
const CORRECTION =
  "整体方向可以。请修订一处：发布流程太繁琐，把「发布商品」合并为单页表单（标题、描述、价格、图片一步填完），去掉分步填写。请修订结构化文本并重新生成 HTML 原型快照。";

/** 累计出现的 HTML 快照数（跨轮累计） */
function htmlCount() {
  return rawReplies.reduce((n, c) => n + (c.split("%%%HTML_BEGIN%%%").length - 1), 0);
}

const rawReplies = []; // 原始消息（含 marker），做表格/问号统计
async function sendAndWait(text, roundNo) {
  console.log(`  [对话] 第 ${roundNo} 轮发送: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
  await page.locator("textarea").fill(text);
  await page.getByRole("button", { name: "发送" }).click();
  // 等待回复完成：textarea 重新可用
  await page.waitForFunction(
    () => {
      const ta = document.querySelector("textarea");
      return ta && !ta.disabled;
    },
    null,
    { timeout: 120000 }
  );
  console.log(`  [对话] 第 ${roundNo} 轮回复完成`);
  // 回复完成后可能出现文件确认框（原型.md 是正式交付物，弹确认框）——点掉
  try {
    const confirmBtn = page.getByRole("button", { name: "确认写入" });
    await confirmBtn.waitFor({ state: "visible", timeout: 4000 });
    await confirmBtn.click();
    console.log(`  [对话] 第 ${roundNo} 轮点击了「确认写入」`);
    await page.waitForTimeout(400);
  } catch {
    // 无确认框（本轮回复未产出文件）
  }
  // 记录当前所有 assistant 原始消息（含 markers）
  const msgs = await page.evaluate(async (tid) => {
    const res = await fetch(`/api/tabs/${tid}/messages`);
    const data = await res.json();
    return (data.messages ?? []).filter((m) => m.role === "assistant").map((m) => m.content);
  }, tabId);
  rawReplies.length = 0;
  rawReplies.push(...msgs);
}

await sendAndWait(OPENING, 1);
let correctionSent = false;
for (let i = 0; i < MAX_ROUNDS - 1; i++) {
  const last = rawReplies[rawReplies.length - 1] ?? "";
  // 已产出原型.md（精确匹配 marker + 文件名）
  if (/%%%FILE_BEGIN%%%\s*原型\.md/.test(last)) break;
  const hCount = htmlCount();
  let text;
  if (hCount === 0) {
    // Agent 还没给方案/快照——催一次
    text = "请先给出整体方案（页面清单 + 用户流程）并生成 HTML 原型快照。";
  } else if (!correctionSent) {
    text = CORRECTION;
    correctionSent = true;
  } else if (hCount < 2) {
    // 指正后 Agent 未重新生成快照——再催
    text = "修订意见如上，请修订并重新生成 HTML 原型快照。";
  } else {
    // 快照已重新生成 → 完满确认
    text = "完满。请按自检清单检查后输出原型.md。";
  }
  await sendAndWait(text, i + 2);
}

// ── 断言 1：HTML 快照与下载按钮 ──────────────────────────
const hCount = htmlCount();
check("对话中出现 HTML 原型快照（≥1 次）", hCount >= 1, `(实际 ${hCount} 次)`);
check("指正后重新生成 HTML 快照（≥2 次，确认闭环）", hCount >= 2, `(实际 ${hCount} 次)`);

// 前端「下载 HTML 原型」按钮：存在 + 点击触发下载（Blob 单文件 HTML）
const downloadBtn = page.getByRole("button", { name: "下载 HTML 原型" }).first();
await downloadBtn.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
const btnVisible = await downloadBtn.isVisible().catch(() => false);
check("前端渲染「下载 HTML 原型」按钮", btnVisible);
if (btnVisible) {
  const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
  await downloadBtn.click();
  let dlOk = false;
  let dlDetail = "";
  try {
    const download = await downloadPromise;
    dlOk = (download.suggestedFilename() ?? "").endsWith(".html");
    dlDetail = `filename=${download.suggestedFilename()}`;
    // 内容断言：单文件 HTML（浏览器可打开）。严格校验首行不被 marker
    // 解析吞掉——<html 或 <!DOCTYPE 必须是正文第一个标签（code review 修复：
    // HTML 分支曾把首行吞进文件名捕获槽导致 DOCTYPE 丢失）
    const stream = await download.createReadStream();
    let body = "";
    for await (const chunk of stream) body += chunk.toString();
    const htmlOk = /^(<!doctype html|<html)/i.test(body.trimStart().slice(0, 200));
    check("下载内容为单文件 HTML（首行完整、浏览器可打开）", htmlOk, `(内容开头=${body.slice(0, 80).replace(/\n/g, " ")})`);
  } catch (e) {
    dlDetail += ` download 事件异常: ${e?.message?.slice(0, 80) ?? e}`;
  }
  check("点击下载按钮触发下载（.html 文件）", dlOk, `(${dlDetail})`);
}

// ── 断言 2：冻结与落盘 ──────────────────────────────────
// tab.scope_frozen 应为 true（「完满」肯定词通过 SCOPE_FREEZE_CONFIRM_RE 校验）
const tabsInfo = await page.evaluate(async (wid) => {
  const res = await fetch(`/api/work-records/${wid}/tabs`);
  return res.json();
}, workRecordId);
// GET /api/work-records/[id]/tabs 返回裸数组（tabs.map 直出）
const tabList = Array.isArray(tabsInfo) ? tabsInfo : (tabsInfo.tabs ?? []);
const ptTab = tabList.find((t) => t.agent_type === "prototype");
check("「完满」确认后 tab.scope_frozen = true", ptTab?.scope_frozen === true, `(实际=${JSON.stringify(ptTab?.scope_frozen)})`);

const last = rawReplies[rawReplies.length - 1] ?? "";
check("Agent 输出原型.md（FILE marker）", /%%%FILE_BEGIN%%%\s*原型\.md/.test(last), `(末轮回复=${last.slice(0, 80).replace(/\n/g, " ")})`);
// 决策点 2：Agent 冻结前做自检清单并展示（「自检」字样或 - [x] 条目形态）
check(
  "冻结前展示自检清单（自检/核对条目）",
  /自检|核对|检查清单|- \[x\]/.test(rawReplies.join("")),
  `(末轮回复片段=${last.slice(0, 200).replace(/\n/g, " ")})`
);

const files = await page.evaluate(async (pid) => {
  const res = await fetch(`/api/projects/${pid}/files`);
  return res.json();
}, projectId);
const fileByName = (name) => files.find((f) => f.filename.includes(name));
const protoDoc = fileByName("原型.md");
check("原型.md 落盘并出现在文件树", !!protoDoc, `(文件列表=${files.map((f) => f.filename).join("、")})`);

if (protoDoc) {
  const protoContent = await page.evaluate(async ({ pid, fid }) => {
    const res = await fetch(`/api/projects/${pid}/files/${fid}`);
    const data = await res.json();
    return data.content ?? "";
  }, { pid: projectId, fid: protoDoc.id ?? protoDoc._id });
  const body = protoContent.replace(/^<!--\nchangelog:[\s\S]*?-->\n?/, "");
  // 五字段（spec: 页面清单 目的/元素/操作/入口·出口/依赖）+ 用户流程
  const fiveFields = ["目的", "元素", "操作", "入口·出口", "依赖"];
  for (const f of fiveFields) {
    check(`原型.md 页面清单含「${f}」`, body.includes(f), `(五字段完整性)`);
  }
  check("原型.md 含「用户流程」段", body.includes("用户流程"));
  // 显示文案（决策点 3：元素含显示文案——「显示文案」字样或「…」中文引号形式）
  const hasCopy = /显示文案|「[^」]{1,20}」/.test(body);
  check("原型.md 元素含显示文案", hasCopy, `(应出现「显示文案」或「…」引号文案；片段=${body.slice(0, 200).replace(/\n/g, " ")})`);
}

// ── 轻量检查：对话纪律（WARN 不 fail）────────────────────
// 只统计对话流可见文本——剥离 FILE markers 与 HTML 快照（文件/快照内的
// 表格不属于「对话流回复」约束）
for (const [i, content] of rawReplies.entries()) {
  const visible = content
    .replace(/%%%FILE_BEGIN%%%[\s\S]*?%%%FILE_END%%%/g, "")
    .replace(/%%%HTML_BEGIN%%%[\s\S]*?%%%HTML_END%%%/g, "");
  const tableLines = (visible.match(/^\s*\|.+\|\s*$/gm) ?? []).length;
  if (tableLines > 5) {
    warn(`第 ${i + 1} 条回复表格 ${tableLines} 行（5×5 边界内应为 ≤5）`);
  }
  const maxCols = Math.max(
    0,
    ...(visible.match(/^\s*\|.+\|\s*$/gm) ?? []).map((l) =>
      (l.match(/\|/g) ?? []).length - 1
    )
  );
  if (maxCols > 5) {
    warn(`第 ${i + 1} 条回复表格 ${maxCols} 列（5×5 边界内应为 ≤5）`);
  }
  const questions = (visible.match(/[？?]/g) ?? []).length;
  if (questions > 4) {
    warn(`第 ${i + 1} 条回复问号 ${questions} 个（决策点制代理指标，明显异常）`);
  }
}
if (warnCount === 0) console.log("  ✅ 对话纪律轻量检查全部通过（无 WARN）");

// ── 失败诊断：对话轮次摘要 ──────────────────────────────
if (fail > 0 || warnCount > 0) {
  console.log("  ── 对话轮次摘要（诊断）──");
  rawReplies.forEach((c, i) =>
    console.log(`  [${i + 1}] ${c.slice(0, 150).replace(/\n/g, " ")}`)
  );
}

await browser.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败${warnCount ? `, ${warnCount} 条 WARN` : ""}`);
process.exit(fail > 0 ? 1 : 0);
