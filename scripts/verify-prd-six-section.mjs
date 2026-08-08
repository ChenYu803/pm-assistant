// 验证 05 ticket：PRD Agent 六章重构（ADR-0002/0003 + mini 会决策）
// - mvp_prd tab 创建时自动加载 需求分析.md + 原型.md（存在时）
// - 真实对话：二次确认需求分析结论（不重新讨论）→ 概念版（≤300 字，含外部依赖声明）
// - 真实对话：范围冻结（肯定词 → %%%SCOPE_FROZEN%%% → tab.scope_frozen = true）
// - 概念版落盘为文件树独立文件「概念版（…）.md」（05 mini 会决策，修订 ADR-0003）
// - 概念版不可加载进 Agent 上下文（POST 加载 400）
// - 真实对话：实体聚合 + 业务规则补缺走查 + 验收标准确认 → 六章齐全输出 prd.md
// - prd.md 断言：六章齐全（概念/Out of Scope/页面清单/实体级数据模型/用户流程+验收标准/文案基调）
// - prd.md 断言：第 3 章 = 原型.md 页面清单段原文（零转换嵌入）；第 5 章 = 用户流程段原文
// - prd.md 断言：外部依赖声明只在概念章出现一次（单源）；概念版内容不写入 prd.md
// 前置：dev server 运行在 localhost:3000，MongoDB 可连（.env.local 的 MONGODB_URI），
//       DEEPSEEK_API_KEY 有效（真实对话需要）
// 用法: node scripts/verify-prd-six-section.mjs
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";

const email = `verify-prd-${Date.now()}@test.local`;
const password = "verify-pass-1234";
const MAX_ROUNDS = 14; // 真实对话轮数上限（控制 token 消耗）
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
await page.fill('input[placeholder="输入项目名称"]', "验证 PRD 六章");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /验证 PRD 六章/ }).click();
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

// ── 直接用 API 写入 需求分析.md + 原型.md（省掉前两环对话，PRD 环节是测试对象）
//    数据设计：规则点尽量覆盖全面（异常/边界/排除项齐备），减少 grilling 轮数；
//    外部依赖为「无」（不做在线支付 → 货到付款），概念版外部依赖声明断言其存在 ──
const reqContent =
  "## 1. 在线点餐\n\n" +
  "### 用户与场景\n" +
  "公司员工，午休时间到店点餐，目前靠到店排队点餐，高峰时段耗时 15 分钟以上。\n\n" +
  "### 用户故事\n" +
  "作为顾客，我想要浏览菜品并提前下单，以便到店即取、不用排队。\n\n" +
  "### 功能范围\n" +
  "做 X：菜品浏览与搜索、购物车、提交订单、订单状态查看（P0）；用户登录（P1）。不做 Y：在线支付（MVP 采用货到付款，降低支付接入复杂度）、外卖配送（到店自取为主，配送需要物流对接）、优惠券系统（低频需求）。\n\n" +
  "### 成功指标\n" +
  "上线 1 个月内日均订单 30 单、下单平均耗时 <2 分钟。\n\n" +
  "# 排除清单\n\n" +
  "- 在线支付 — 理由：MVP 采用货到付款降低接入复杂度，取舍阶段：强烈\n" +
  "- 外卖配送 — 理由：需要对接物流服务，MVP 聚焦到店自取，取舍阶段：频率\n" +
  "- 优惠券系统 — 理由：低频需求，MVP 不投入，取舍阶段：真实";

const protoContent =
  "## 菜品浏览页\n\n" +
  "- **目的**：让顾客浏览菜品、搜索筛选并加入购物车\n" +
  "- **元素**：菜品列表（显示文案「菜品名称/价格/描述」）：卡片式列表；搜索框（显示文案「搜索菜品」）：输入控件；加入购物车按钮（显示文案「加入购物车」）：操作按钮；已售罄标记（显示文案「已售罄」）：状态标签\n" +
  "- **操作**：搜索：输入关键词 → 列表实时过滤；加入购物车：点击 → 数量 +1，按钮显示反馈「已加入」\n" +
  "- **入口·出口**：从首页进入 / 可前往购物车页与订单页\n" +
  "- **依赖**：菜品数据、购物车状态\n\n" +
  "## 购物车页\n\n" +
  "- **目的**：让顾客查看已选菜品、调整数量并提交订单\n" +
  "- **元素**：已选菜品列表（显示文案「菜品名称 × 数量/小计」）：列表式；数量加减按钮（显示文案「+/−」）：操作控件；提交订单按钮（显示文案「提交订单」）：主操作按钮\n" +
  "- **操作**：调整数量：点击 +/− → 小计实时更新；提交订单：点击 → 创建订单并跳转订单详情页\n" +
  "- **入口·出口**：从菜品浏览页进入 / 提交后可前往订单详情页\n" +
  "- **依赖**：购物车状态、订单数据\n\n" +
  "## 用户流程：浏览并提交订单\n\n" +
  "- **触发**：顾客午休时间打开点餐应用\n" +
  "- **主路径**：打开应用 → 菜品浏览页 浏览/搜索菜品 → 点击「加入购物车」→ 购物车页 查看已选菜品并调整数量 → 点击「提交订单」→ 跳转订单详情页查看订单状态\n" +
  "- **异常分支**：购物车为空时点击「提交订单」→ 提示「购物车为空」并停留在购物车页\n" +
  "- **边界情况**：菜品售罄 → 浏览页标记「已售罄」且加入购物车按钮禁用；重复点击提交 → 提示「订单已提交，请勿重复操作」并跳转订单详情页\n\n" +
  "## 用户流程：查看订单状态\n\n" +
  "- **触发**：顾客提交订单后想确认订单状态\n" +
  "- **主路径**：订单详情页 查看订单状态（待取餐 → 已出餐 → 已完成）→ 到店出示订单取餐\n" +
  "- **异常分支**：订单状态未更新 → 显示「商家备餐中」等待提示\n" +
  "- **边界情况**：订单已完成 → 显示「订单已完成」并可再次下单";

for (const [filename, content] of [["需求分析.md", reqContent], ["原型.md", protoContent]]) {
  const writeRes = await page.evaluate(async ({ pid, filename, content }) => {
    const res = await fetch(`/api/projects/${pid}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, content, agent_type: "mvp_prd" }),
    });
    return { status: res.status };
  }, { pid: projectId, filename, content });
  check(`${filename} 已写入（前置准备）`, writeRes.status === 200 || writeRes.status === 201, `(status=${writeRes.status})`);
}

// ── API 创建 mvp_prd tab，断言自动加载 需求分析.md + 原型.md ──
const created = await page.evaluate(async (wid) => {
  const res = await fetch(`/api/work-records/${wid}/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_type: "mvp_prd" }),
  });
  const data = await res.json();
  return { status: res.status, tab: data.tab, context: (data.context_files ?? []).map((f) => f.filename) };
}, workRecordId);
check("创建 mvp_prd tab 成功", created.status === 201, `(status=${created.status})`);
const tabId = created.tab?.id ?? created.tab?._id;
check("拿到 tab id", !!tabId, `(实际=${JSON.stringify(created.tab)?.slice(0, 120)})`);
const ctxNames = created.context ?? [];
check(
  "PRD tab 自动加载 需求分析.md + 原型.md",
  ctxNames.includes("需求分析.md") && ctxNames.includes("原型.md"),
  `(context=${JSON.stringify(ctxNames)})`
);

// 激活该 tab（API 创建的 tab 需先刷新页面；TabBar 的 tab 是 div 而非 button）
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByText("MVP-PRD #1", { exact: true }).first().click();
await page.waitForTimeout(600);

// ── 真实对话：二次确认 → 概念版 → 冻结 → 六章输出 ───────────
const rawReplies = []; // 原始消息（含 marker），做断言与诊断
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
    { timeout: 180000 }
  );
  console.log(`  [对话] 第 ${roundNo} 轮回复完成`);
  // 回复完成后可能出现文件确认框（概念版 / prd.md 是正式落盘文件，弹确认框）——点掉
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

const OPENING =
  "请基于已加载的需求分析.md 和原型.md 开始撰写 PRD。\n" +
  "流程请按你的规范走：先二次确认需求分析结论，再概念版与范围冻结，然后详细撰写六章。";
await sendAndWait(OPENING, 1);

let conceptRound = -1; // 概念版轮次（1-based）
for (let i = 0; i < MAX_ROUNDS - 1; i++) {
  const last = rawReplies[rawReplies.length - 1] ?? "";
  // 已产出 prd.md（六章齐全文档）——完成
  if (/%%%FILE_BEGIN%%%\s*prd\.md/.test(last)) break;
  let text;
  if (conceptRound === -1 && /概念版/.test(last)) {
    conceptRound = rawReplies.length;
    // 概念版已输出（断言在循环外），用户确认范围
    text = "确认。范围没问题，开始详细撰写。";
  } else if (/%%%FILE_BEGIN%%%/.test(last)) {
    // 概念版刚写入 + 冻结 → 推进
    text = "继续。";
  } else {
    // 复述确认 / grilling 补缺 / 验收标准确认——万能肯定推进
    text = "确认，没有遗漏，按你的方案继续。";
  }
  await sendAndWait(text, i + 2);
}

// ── 断言 1：概念版与范围冻结 ────────────────────────────
const allReplies = rawReplies.join("\n");
check(
  "二次确认轮：Agent 复述需求分析结论（不重新讨论）",
  /菜品|在线点餐|顾客/.test(rawReplies[0] ?? ""),
  `(首轮回复=${(rawReplies[0] ?? "").slice(0, 120).replace(/\n/g, " ")})`
);
check(
  "对话中出现概念版（含外部依赖声明）",
  conceptRound !== -1 && /外部依赖/.test(allReplies),
  `(概念版轮次=${conceptRound}; 对话长度=${allReplies.length})`
);
if (conceptRound !== -1) {
  const conceptText = rawReplies[conceptRound - 1] ?? "";
  // 概念版格式字段齐全（spec US28：三视角确认 → 概念版 ≤300 字 → 范围冻结）
  const fields = ["核心用户", "要解决的一件事", "产品形态", "MVP 功能", "本版本不做什么", "商业模式", "外部依赖声明"];
  const missing = fields.filter((f) => !conceptText.includes(f));
  check("概念版格式字段齐全", missing.length === 0, `(缺 ${missing.join("、") || "无"})`);
  check("概念版 ≤300 字", conceptText.length <= 650, `(实际 ${conceptText.length} 字符，含格式外壳；核心内容应 ≤300 字)`);
}
check(
  "Agent 输出 %%%SCOPE_FROZEN%%% 标记（范围冻结）",
  allReplies.includes("%%%SCOPE_FROZEN%%%"),
  `(末轮片段=${(rawReplies[rawReplies.length - 1] ?? "").slice(0, 80).replace(/\n/g, " ")})`
);

// tab.scope_frozen 应为 true（「确认」肯定词通过 SCOPE_FREEZE_CONFIRM_RE 校验）
const tabsInfo = await page.evaluate(async (wid) => {
  const res = await fetch(`/api/work-records/${wid}/tabs`);
  return res.json();
}, workRecordId);
const tabList = Array.isArray(tabsInfo) ? tabsInfo : (tabsInfo.tabs ?? []);
const prdTab = tabList.find((t) => t.agent_type === "mvp_prd");
check("范围冻结确认后 tab.scope_frozen = true", prdTab?.scope_frozen === true, `(实际=${JSON.stringify(prdTab?.scope_frozen)})`);

// ── 断言 2：概念版落盘 + 不可加载 ────────────────────────
const files = await page.evaluate(async (pid) => {
  const res = await fetch(`/api/projects/${pid}/files`);
  return res.json();
}, projectId);
const fileByName = (name) => files.find((f) => f.filename.includes(name));
const conceptDoc = fileByName("概念版");
check(
  "概念版落盘为文件树独立文件「概念版（…）.md」",
  !!conceptDoc && /^概念版.*\.md$/.test(conceptDoc.filename),
  `(文件列表=${files.map((f) => f.filename).join("、")})`
);

if (conceptDoc) {
  const loadRes = await page.evaluate(async ({ tid, fid }) => {
    const res = await fetch(`/api/tabs/${tid}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fid }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }, { tid: tabId, fid: conceptDoc.id ?? conceptDoc._id });
  check("概念版不可加载进 Agent 上下文（POST 400）", loadRes.status === 400, `(status=${loadRes.status})`);
}

// ── 断言 3：prd.md 六章齐全 + 一致性 ─────────────────────
const last = rawReplies[rawReplies.length - 1] ?? "";
check("Agent 输出 prd.md（FILE marker）", /%%%FILE_BEGIN%%%\s*prd\.md/.test(last), `(末轮回复=${last.slice(0, 80).replace(/\n/g, " ")})`);

const prdDoc = fileByName("prd.md");
check("prd.md 落盘并出现在文件树", !!prdDoc, `(文件列表=${files.map((f) => f.filename).join("、")})`);

async function readBody(pid, file) {
  const data = await page.evaluate(async ({ pid, fid }) => {
    const res = await fetch(`/api/projects/${pid}/files/${fid}`);
    const d = await res.json();
    return d.content ?? "";
  }, { pid, fid: file.id ?? file._id });
  // 剥离 changelog 头（同 stripChangelogHeader）
  return data.replace(/^<!--\nchangelog:[\s\S]*?-->\n?/, "");
}

const prdBody = prdDoc ? await readBody(projectId, prdDoc) : "";
const protoBody = await readBody(projectId, protoDoc);
const conceptBody = conceptDoc ? await readBody(projectId, conceptDoc) : "";

// 六章齐全（spec US30：缺任何一章 = 输出未完成）
const chapters = [
  ["① 概念", /##\s*1[.、]\s*概念/],
  ["② Out of Scope", /##\s*2[.、]\s*Out of Scope/i],
  ["③ 页面清单", /##\s*3[.、]\s*页面清单/],
  ["④ 实体级数据模型", /##\s*4[.、]\s*实体级数据模型/],
  ["⑤ 用户流程 + 验收标准", /##\s*5[.、]\s*用户流程/],
  ["⑥ 文案基调", /##\s*6[.、]\s*文案基调/],
];
for (const [name, re] of chapters) {
  check(`prd.md 六章齐全：${name}`, re.test(prdBody), `(应含「## N. ${name.replace(/^[①-⑥] /, "")}」章节标题)`);
}

// 第 2 章引用需求分析.md「排除清单」段（03 跨 ticket 债务：整体引用而非行内）
check(
  "Out of Scope 章引用排除清单（被排除需求 + 理由 + 取舍阶段）",
  /排除清单|在线支付|外卖配送|取舍阶段/.test(prdBody) && /##\s*2[.、]\s*Out of Scope[\s\S]*##\s*3/.test(prdBody),
  `(第 2 章片段=${prdBody.match(/##\s*2[.、]\s*Out of Scope[\s\S]{0,200}/)?.[0]?.replace(/\n/g, " ")})`
);

// 第 3、5 章与原型.md 零转换一致性：原型.md 每个「## 页面名」块 ∈ 第 3 章；
// 每个「## 用户流程：[场景]」块 ∈ 第 5 章（结构措辞原样，不重写）
function splitSections(body) {
  const blocks = [];
  let cur = null;
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) {
      if (cur) blocks.push({ title: cur.title, text: cur.text });
      cur = { title: line, text: line };
    } else if (cur) {
      cur.text += "\n" + line;
    }
  }
  if (cur) blocks.push({ title: cur.title, text: cur.text });
  return blocks;
}
const ch3 = prdBody.match(/##\s*3[.、]\s*页面清单[\s\S]*?(?=##\s*4[.、])/)?.[0] ?? "";
const ch5 = prdBody.match(/##\s*5[.、]\s*用户流程[\s\S]*?(?=##\s*6[.、])/)?.[0] ?? "";
const protoBlocks = splitSections(protoBody);
let pageBlockMismatch = 0;
let flowBlockMismatch = 0;
for (const block of protoBlocks) {
  const text = block.text.trim();
  if (block.title.startsWith("## 用户流程：")) {
    if (!ch5.includes(text)) flowBlockMismatch++;
  } else {
    if (!ch3.includes(text)) pageBlockMismatch++;
  }
}
check(
  "第 3 章 = 原型.md 页面清单段原文（零转换嵌入）",
  pageBlockMismatch === 0 && protoBlocks.some((b) => !b.title.startsWith("## 用户流程：")),
  `(不一致块 ${pageBlockMismatch} 个；原型.md 块数=${protoBlocks.length})`
);
check(
  "第 5 章 = 原型.md 用户流程段原文（零转换嵌入）",
  flowBlockMismatch === 0 && protoBlocks.some((b) => b.title.startsWith("## 用户流程：")),
  `(不一致块 ${flowBlockMismatch} 个)`
);

// 外部依赖声明只在概念章出现一次（spec US31 单源）；概念版内容不写入 prd.md
const afterCh1 = prdBody.replace(/##\s*1[.、]\s*概念[\s\S]*?(?=##\s*2[.、])/, "");
check(
  "外部依赖声明只在概念章出现一次（单源）",
  /##\s*1[.、]\s*概念[\s\S]*外部依赖/.test(prdBody) && !afterCh1.includes("外部依赖"),
  `(第 2-6 章含「外部依赖」=${afterCh1.includes("外部依赖")})`
);
check("概念版内容不写入 prd.md", !prdBody.includes("概念版"), `(prd.md 含「概念版」=${prdBody.includes("概念版")})`);
check("概念版文件内容含外部依赖声明", conceptBody.includes("外部依赖"), `(概念版=${conceptBody.slice(0, 100).replace(/\n/g, " ")})`);

// ── 轻量检查：对话纪律（WARN 不 fail）────────────────────
for (const [i, content] of rawReplies.entries()) {
  const visible = content.replace(/%%%FILE_BEGIN%%%[\s\S]*?%%%FILE_END%%%/g, "");
  const tableLines = (visible.match(/^\s*\|.+\|\s*$/gm) ?? []).length;
  if (tableLines > 5) {
    warn(`第 ${i + 1} 条回复表格 ${tableLines} 行（5×5 边界内应为 ≤5）`);
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
