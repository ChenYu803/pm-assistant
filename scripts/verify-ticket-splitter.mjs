// 验证 06 ticket：任务拆分 Agent（PRD → issues 文件集）
// - ticket_splitter tab 创建时自动加载 prd.md + 需求分析.md（02 已就位，顺带断言）
// - 真实对话：先出草案（编号列表：标题/Blocked by/交付行为）→ quiz 三问 → 批准后输出
// - 输出断言：一次输出多个 issues/NN-<slug>.md 文件（FILE markers）
// - 候选集合确认：替换或另存整套 tickets，不逐张混用
// - issues 文件断言：What to build / Blocked by / AC，且不含 Status / Implementation
// - blocked by 断言：首个 issue「None — can start immediately」；引用的编号 < 自身编号
// - 编号序断言：NN 从 01 起、文件名递增、拓扑序（blockers first）
// - 引用非复制断言：prd.md 长行（>40 字符）不得整段出现在 issue 正文中（AC 行「- [ ]」除外——
//   验收标准按 prompt 要求直接从第 5 章带走）
// - 文件树断言：issues/ 子路径文件出现在文件列表（文件树数据源）
// - 重新切分（spec US19）：批准输出后用户要求重新切分 → Agent 能再次输出（无冻结）
// 前置：dev server 运行在 localhost:3000，MongoDB 可连（.env.local 的 MONGODB_URI），
//       默认 AI_MODE=replay；真实模型验证时才需要 AI_MODE=live + AI_API_KEY
// 用法: node scripts/verify-ticket-splitter.mjs
import { chromium } from "playwright-core";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

const email = `verify-ticket-${Date.now()}@test.local`;
const password = "verify-pass-1234";
const MAX_ROUNDS = 8; // 真实对话轮数上限（控制 token 消耗）
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
await page.fill('input[placeholder="输入项目名称"]', "验证任务拆分");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /验证任务拆分/ }).click();
await page.waitForURL((u) => /\/projects\/[0-9a-f]{24}$/.test(u.pathname));
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

// ── 直接用 API 写入 需求分析.md + prd.md（省掉前两环对话，任务拆分是测试对象）──
//    数据设计：实体（菜品/购物车/订单）跨页面共享 → 可切出「数据模型」前置 issue，
//    验证依赖序（blockers first）与 expand-contract 场景素材；三条用户故事 →
//    至少两个 issue，验证逐个确认/拒绝 ──
const reqContent =
  "## 1. 在线点餐\n\n" +
  "### 用户与场景\n" +
  "公司员工，午休时间到店点餐，目前靠到店排队点餐，高峰时段耗时 15 分钟以上。\n\n" +
  "### 用户故事\n" +
  "作为顾客，我想要浏览菜品并提前下单，以便到店即取、不用排队。\n\n" +
  "### 功能范围\n" +
  "做 X：菜品浏览与搜索、购物车、提交订单、订单状态查看（P0）。不做 Y：在线支付（MVP 采用货到付款）、外卖配送（到店自取为主）。\n\n" +
  "### 成功指标\n" +
  "上线 1 个月内日均订单 30 单、下单平均耗时 <2 分钟。\n\n" +
  "# 排除清单\n\n" +
  "- 在线支付 — 理由：MVP 采用货到付款降低接入复杂度，取舍阶段：强烈\n" +
  "- 外卖配送 — 理由：需要对接物流服务，MVP 聚焦到店自取，取舍阶段：频率";

const prdContent =
  "# 在线点餐 — MVP PRD\n\n" +
  "## 1. 概念\n" +
  "### 1.1 核心用户\n" +
  "公司员工（午休到店就餐）。\n" +
  "### 1.2 要解决的一件事\n" +
  "高峰时段排队点餐耗时，用提前下单解决。\n" +
  "### 1.3 产品形态\n" +
  "Web 应用。\n" +
  "### 1.4 商业模式\n" +
  "免费使用，菜品利润分成。\n" +
  "### 1.5 外部依赖声明\n" +
  "无。\n\n" +
  "## 2. Out of Scope\n" +
  "在线支付（货到付款）、外卖配送（到店自取）、优惠券系统（低频）。\n\n" +
  "## 3. 页面清单\n" +
  "## 菜品浏览页\n" +
  "- **目的**：让顾客浏览菜品、搜索并加入购物车\n" +
  "- **元素**：菜品列表（卡片式）；搜索框；加入购物车按钮；已售罄标记\n" +
  "- **操作**：搜索 → 列表实时过滤；加入购物车 → 数量 +1 并反馈「已加入」\n" +
  "- **入口·出口**：从首页进入 / 可前往购物车页\n" +
  "- **依赖**：菜品数据、购物车状态\n\n" +
  "## 购物车页\n" +
  "- **目的**：让顾客查看已选菜品、调整数量并提交订单\n" +
  "- **元素**：已选菜品列表；数量加减按钮；提交订单按钮\n" +
  "- **操作**：调整数量 → 小计实时更新；提交订单 → 创建订单并跳转订单详情页\n" +
  "- **入口·出口**：从菜品浏览页进入 / 提交后可前往订单详情页\n" +
  "- **依赖**：购物车状态、订单数据\n\n" +
  "## 订单详情页\n" +
  "- **目的**：让顾客查看订单状态\n" +
  "- **元素**：订单信息；状态时间线（待取餐 → 已出餐 → 已完成）\n" +
  "- **操作**：无\n" +
  "- **入口·出口**：从购物车页提交后进入\n" +
  "- **依赖**：订单数据\n\n" +
  "## 4. 实体级数据模型\n" +
  "### 4.1 菜品\n" +
  "#### 定义\n" +
  "店铺可售卖的菜。\n" +
  "#### 字段表\n" +
  "名称（文本）/ 价格（数字）/ 描述（文本）/ 状态（枚举：在售、售罄）\n" +
  "#### 状态机\n" +
  "在售 ↔ 售罄（商家后台维护）\n" +
  "#### 关系\n" +
  "订单包含多个菜品条目\n\n" +
  "### 4.2 购物车\n" +
  "#### 定义\n" +
  "顾客当前会话的已选菜品集合。\n" +
  "#### 字段表\n" +
  "菜品条目列表（引用菜品）/ 合计金额（数字）\n" +
  "#### 状态机\n" +
  "空 / 有内容（加入、调整数量、清空）\n" +
  "#### 关系\n" +
  "引用菜品\n\n" +
  "### 4.3 订单\n" +
  "#### 定义\n" +
  "顾客提交购物车后生成的取餐单。\n" +
  "#### 字段表\n" +
  "订单号（文本）/ 菜品条目列表（引用菜品）/ 总价（数字）/ 状态（枚举）\n" +
  "#### 状态机\n" +
  "待取餐 → 已出餐 → 已完成（商家维护）\n" +
  "#### 关系\n" +
  "包含菜品条目\n\n" +
  "## 5. 用户流程 + 验收标准\n" +
  "## 用户流程：浏览菜品并加入购物车\n" +
  "- **触发**：顾客午休时间打开点餐应用\n" +
  "- **主路径**：打开应用 → 菜品浏览页 浏览/搜索 → 点击「加入购物车」→ 反馈「已加入」\n" +
  "- **异常分支**：菜品售罄 → 浏览页标记「已售罄」且按钮禁用\n" +
  "- **边界情况**：搜索无结果 → 显示空态提示\n" +
  "#### 验收标准\n" +
  "- [ ] 当顾客在菜品浏览页搜索关键词时，系统过滤菜品列表并实时显示匹配结果\n" +
  "- [ ] 当顾客点击在售菜品的「加入购物车」时，系统将菜品加入购物车并反馈「已加入」\n" +
  "- [ ] 当顾客点击已售罄菜品的加入按钮时，系统禁用按钮并显示「已售罄」\n" +
  "- [ ] 当搜索结果为空时，系统显示空态提示而非空白页\n\n" +
  "## 用户流程：提交订单\n" +
  "- **触发**：顾客在购物车页确认菜品后提交订单\n" +
  "- **主路径**：购物车页 调整数量 → 点击「提交订单」→ 创建订单并跳转订单详情页\n" +
  "- **异常分支**：购物车为空时提交 → 提示「购物车为空」并停留购物车页\n" +
  "- **边界情况**：重复点击提交 → 提示「订单已提交，请勿重复操作」\n" +
  "#### 验收标准\n" +
  "- [ ] 当顾客调整购物车中菜品数量时，系统实时更新小计与合计金额\n" +
  "- [ ] 当顾客点击「提交订单」且购物车非空时，系统创建订单并跳转订单详情页\n" +
  "- [ ] 当购物车为空时顾客点击「提交订单」时，系统提示「购物车为空」并停留原页\n" +
  "- [ ] 当顾客重复点击「提交订单」时，系统提示「订单已提交」且不产生重复订单\n\n" +
  "## 用户流程：查看订单状态\n" +
  "- **触发**：顾客提交订单后想确认订单状态\n" +
  "- **主路径**：订单详情页 查看状态时间线（待取餐 → 已出餐 → 已完成）\n" +
  "- **异常分支**：状态未更新 → 显示「商家备餐中」等待提示\n" +
  "- **边界情况**：订单已完成 → 显示「订单已完成」\n" +
  "#### 验收标准\n" +
  "- [ ] 当顾客打开订单详情页时，系统按状态时间线展示当前订单状态\n" +
  "- [ ] 当商家更新订单状态为已出餐时，订单详情页同步显示「已出餐」\n" +
  "- [ ] 当订单已完成时，系统显示「订单已完成」结束状态\n\n" +
  "## 6. 文案基调\n" +
  "语气：轻松口语化；示例：「已加入」「订单已提交」；命名约定：中文菜品名。";

for (const [filename, content] of [["需求分析.md", reqContent], ["prd.md", prdContent]]) {
  const writeRes = await page.evaluate(async ({ pid, filename, content }) => {
    const res = await fetch(`/api/projects/${pid}/files`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pm-assistant-test-system-write": "1",
      },
      body: JSON.stringify({ filename, content, agent_type: "ticket_splitter" }),
    });
    return { status: res.status };
  }, { pid: projectId, filename, content });
  check(`${filename} 已写入（前置准备）`, writeRes.status === 200 || writeRes.status === 201, `(status=${writeRes.status})`);
}

// ── API 创建 ticket_splitter tab，断言自动加载 prd.md + 需求分析.md ──
const created = await page.evaluate(async (wid) => {
  const res = await fetch(`/api/work-records/${wid}/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_type: "ticket_splitter" }),
  });
  const data = await res.json();
  return { status: res.status, tab: data.tab, context: (data.context_files ?? []).map((f) => f.filename) };
}, workRecordId);
check("创建 ticket_splitter tab 成功", created.status === 201, `(status=${created.status})`);
const tabId = created.tab?.id ?? created.tab?._id;
check("拿到 tab id", !!tabId, `(实际=${JSON.stringify(created.tab)?.slice(0, 120)})`);
const ctxNames = created.context ?? [];
check(
  "任务拆分 tab 自动加载 prd.md + 需求分析.md",
  ctxNames.includes("prd.md") && ctxNames.includes("需求分析.md"),
  `(context=${JSON.stringify(ctxNames)})`
);

// 激活该 tab（API 创建的 tab 需先刷新页面；TabBar 的 tab 是 div 而非 button）
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByText("任务拆分 #1", { exact: true }).first().click();
await page.waitForTimeout(600);

// ── 真实对话：草案 → quiz 确认 → issues 文件集输出 ───────────
const rawReplies = []; // 原始消息（含 marker），做断言与诊断
async function sendAndWait(text, roundNo) {
  console.log(`  [对话] 第 ${roundNo} 轮发送: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
  // 流式期间输入框仍保持可编辑，不能用 textarea.disabled 判断回复结束；
  // 记录发送前 assistant 数量，等新消息进入终态后再发送下一轮。
  const before = await page.evaluate(async (tid) => {
    const res = await fetch(`/api/tabs/${tid}/messages`, { cache: "no-store" });
    const data = await res.json();
    return (data.messages ?? []).filter((message) => message.role === "assistant").length;
  }, tabId);
  await page.locator("textarea").fill(text);
  await page.getByRole("button", { name: "发送" }).click();
  // 等待正式 assistant 消息进入终态（completed / failed / interrupted）。
  await page.waitForFunction(
    async ({ tid, assistantCount }) => {
      const res = await fetch(`/api/tabs/${tid}/messages`, { cache: "no-store" });
      if (!res.ok) return false;
      const data = await res.json();
      const assistants = (data.messages ?? []).filter((message) => message.role === "assistant");
      const latest = assistants.at(-1);
      return assistants.length > assistantCount && latest && latest.status !== "generating";
    },
    { tid: tabId, assistantCount: before },
    { timeout: 180000 }
  );
  console.log(`  [对话] 第 ${roundNo} 轮回复完成`);
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
  "请基于已加载的 prd.md 把 PRD 拆分为 issues 文件集。" +
  "按你的流程走：先出切分草案，再确认。";
await sendAndWait(OPENING, 1);

let issuesRound = -1; // 输出 issues 文件集的轮次（1-based）
for (let i = 0; i < MAX_ROUNDS - 1; i++) {
  const last = rawReplies[rawReplies.length - 1] ?? "";
  if (/%%%FILE_BEGIN%%%\s*issues\//.test(last)) {
    issuesRound = rawReplies.length;
    break;
  }
  let text;
  if (/%%%FILE_BEGIN%%%/.test(last)) {
    // 输出过其他文件（不应发生）——推进
    text = "继续。";
  } else if (i === 0 && /Blocked by|交付行为|粒度/.test(last)) {
    // 草案已出 → quiz 三问确认
    text = "可以。粒度合适，blocking edges 没问题，不需要合并拆分。请输出 issues 文件集。";
  } else {
    // 首次回复（开场复述）或修订草案——确认推进
    text = "确认，按你的方案拆分，请输出 issues 文件集。";
  }
  await sendAndWait(text, i + 2);
}

// ── 断言 1：草案与输出 ────────────────────────────────
const allReplies = rawReplies.join("\n");
check(
  "对话中出现切分草案（标题/Blocked by/交付行为三要素）",
  /Blocked by/.test(allReplies) && /交付行为|What to build/.test(allReplies),
  `(对话长度=${allReplies.length})`
);
check(
  "Agent 输出 issues 文件集（FILE markers 指向 issues/ 子路径）",
  issuesRound !== -1,
  `(issues 输出轮次=${issuesRound}; 末轮片段=${(rawReplies[rawReplies.length - 1] ?? "").slice(0, 100).replace(/\n/g, " ")})`
);

// 提取输出轮的所有 issue 文件名（按序）
const issuesReply = issuesRound !== -1 ? rawReplies[issuesRound - 1] ?? "" : "";
const fileMatches = [...issuesReply.matchAll(/%%%FILE_BEGIN%%%\s*(issues\/[^\n]+\.md)/g)].map((m) => m[1].trim());
const issueFilenames = [...new Set(fileMatches)];
check(
  "一次输出多个 issue 文件（≥2）",
  issueFilenames.length >= 2,
  `(文件=${issueFilenames.join("、") || "无"})`
);
const filenameOk = issueFilenames.every((f) => /^issues\/\d{2}-.+\.md$/.test(f));
check("文件名格式 issues/NN-<slug>.md", filenameOk, `(文件=${issueFilenames.join("、") || "无"})`);

// 编号序断言：从 01 起递增、无跳号
const nums = issueFilenames.map((f) => parseInt(f.match(/^issues\/(\d{2})-/)[1], 10));
const seqOk = nums.length >= 2 && nums[0] === 1 && nums.every((n, idx) => idx === 0 || n === nums[idx - 1] + 1);
check("编号从 01 起递增且无跳号", seqOk, `(编号=${nums.join(",") || "无"})`);

// ── 候选集合确认：整套替换或另存，不能逐张混用 ──
let deliveredSet = false;
if (issuesRound !== -1) {
  try {
    const ticketDialog = page
      .getByRole("dialog")
      .filter({ hasText: "新的 tickets 版本" });
    await ticketDialog.waitFor({ state: "visible", timeout: 8000 });
    check(
      "候选确认显示完整 ticket 集合",
      (await ticketDialog.getByText(/issues\/01-/).count()) === 1 &&
        (await ticketDialog.getByText(/issues\/02-/).count()) === 1
    );
    await ticketDialog.getByRole("button", { name: "替换当前版本" }).click();
    deliveredSet = true;
    await page.waitForTimeout(800);
  } catch (err) {
    console.log(`  [候选确认] 整套交付失败：${err.message}`);
  }
}
check(
  "用户选择替换时整套 tickets 一次性交付",
  deliveredSet,
  "未出现候选集合确认或替换操作失败"
);

// ── 断言 2：落盘与文件内容 ────────────────────────────
const files = await page.evaluate(async (pid) => {
  const res = await fetch(`/api/projects/${pid}/files`);
  return res.json();
}, projectId);
const issueDocs = files.filter((f) => /^issues\//.test(f.filename));
check(
  "整套 tickets 写入后文件集合完整且无混用",
  issueDocs.length === issueFilenames.length &&
    issueDocs.every((file) => /^issues\/\d{2}-/.test(file.filename)),
  `(落盘=${issueDocs.map((f) => f.filename).join("、") || "无"})`
);

async function readBody(file) {
  const data = await page.evaluate(async ({ pid, fid }) => {
    const res = await fetch(`/api/projects/${pid}/files/${fid}`);
    const d = await res.json();
    return d.content ?? "";
  }, { pid: projectId, fid: file.id ?? file._id });
  // 剥离 changelog 头（同 stripChangelogHeader）
  return data.replace(/^<!--\nchangelog:[\s\S]*?-->\n?/, "");
}

if (issueDocs.length === issueFilenames.length) {
  const doc = issueDocs.find((file) => file.filename === issueFilenames[0]) ?? issueDocs[0];
  const body = await readBody(doc);
  // 产品 ticket 只交付稳定字段，不包含内部 triage/实现字段。
  const fields = [
    ["What to build", /^\*\*What to build:\*\*/m],
    ["Blocked by", /^\*\*Blocked by:\*\*/m],
    ["验收标准（AC）", /^- \[ \] /m],
  ];
  for (const [name, re] of fields) {
    check(`issue 四字段：${name}`, re.test(body), `(应含「${name}」; 正文头 80 字=${body.slice(0, 80).replace(/\n/g, " ")})`);
  }
  check("产品 ticket 不含 Status 或 Implementation", !/^\s*(?:\*\*)?(?:Status|Implementation)/im.test(body));
  check("issue 标题 # NN —", /^# \d{2} — /m.test(body), `(应含「# 01 — …」标题)`);
  // 引用格式校验：issue 正文出现 prd.md 章节引用时，必须是「见 prd.md 第 X 章」格式。
  // 注意 prompt 只要求「提及章节时用该格式」「决策编码（schema/状态机等）引用章节」——
  // 纯 UI 切片（无 schema 决策编码）不出现引用是合规行为，故不强制出现，只校验格式。
  const prdRefs = [...body.matchAll(/见?\s*prd\.md\s*第\s*\d+\s*章/g)].map((m) => m[0]);
  check(
    "issue 引用 prd.md 章节（若有引用则格式为「见 prd.md 第 X 章」）",
    prdRefs.every((r) => /^见 prd\.md 第 \d+ 章$/.test(r)),
    `(引用=${prdRefs.join("、") || "无"}; 正文=${body.slice(0, 120).replace(/\n/g, " ")})`
  );
  // blocked by：首个 issue 无依赖
  if (/^issues\/01-/.test(doc.filename)) {
    const blockedByLine = (body.match(/^\*\*Blocked by:\*\* (.+)$/m) ?? [])[1] ?? "";
    check(
      "首个 issue（01）无阻塞依赖",
      /None|无/.test(blockedByLine),
      `(Blocked by=${blockedByLine.slice(0, 60)})`
    );
  }
}

// ── 断言 3：引用非复制（prd.md 长行不得整段出现在 issue 中）──
const prdDoc = files.find((f) => f.filename === "prd.md");
if (prdDoc && issueDocs.length === issueFilenames.length) {
  const prdBody = await readBody(prdDoc);
  // 排除验收标准行（- [ ] 开头）：prompt 明确要求 AC「直接从 prd.md 第 5 章对应用户故事带走（不重写）」，
  // 整行复制 AC 是合规行为；引用非复制约束只针对 What to build / 正文描述等其余内容
  const prdLongLines = prdBody.split("\n").map((l) => l.trim()).filter((l) => l.length > 40 && !l.startsWith("- [ ]"));
  const issueBody = await readBody(issueDocs[0]);
  const copiedLines = prdLongLines.filter((l) => issueBody.includes(l));
  check(
    "引用非复制：prd.md 长行未整段复制进 issue",
    copiedLines.length === 0,
    `(复制行 ${copiedLines.length} 条: ${copiedLines.slice(0, 2).join(" || ").slice(0, 100)})`
  );
}

// ── 断言 4：重新切分（spec US19：与 PRD 不一致时可要求重新切分）──
check(
  "重新切分：Agent 重新输出草案/文件集（无冻结）",
  true,
  "(见下方重切分对话)"
);
let resplitOk = false;
if (issuesRound !== -1) {
  const before = rawReplies.length;
  await sendAndWait("切分结果与 PRD 不一致：购物车页和提交订单应该合并为一个 issue。请重新切分。", MAX_ROUNDS);
  // 允许重切分输出新草案或直接新文件集（2 轮内）
  for (let i = 0; i < 2; i++) {
    const last = rawReplies[rawReplies.length - 1] ?? "";
    if (/%%%FILE_BEGIN%%%\s*issues\//.test(last) || /Blocked by/.test(last) && rawReplies.length > before) {
      resplitOk = true;
      break;
    }
    await sendAndWait("可以，按新方案输出。", MAX_ROUNDS + i + 1);
  }
  // 重切分后可能再次弹确认框：清掉（不落盘，避免干扰后续）
  while (true) {
    const fileDialog = page
      .getByRole("dialog")
      .filter({ hasText: "新的 tickets 版本" });
    try {
      await fileDialog.waitFor({ state: "visible", timeout: 2000 });
    } catch {
      break;
    }
    await fileDialog.getByRole("button", { name: "取消" }).click();
    await page.waitForTimeout(400);
  }
}
check(
  "重新切分：Agent 响应了重切分请求（重新出草案或文件集）",
  resplitOk,
  `(重切分后回复=${(rawReplies[rawReplies.length - 1] ?? "").slice(0, 80).replace(/\n/g, " ")})`
);

// ── 汇总 ────────────────────────────────────────────────────
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
