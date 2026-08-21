// 验证 07 ticket：四环全流程端到端走查（verify-v1-flow）
// 单脚本串联完整流水线（与各环节独立脚本互为补充：这里验证「链式走通」，各环断言复用
// 03/04/05/06 的结构断言核心，但每环轮数收紧——RA=10 / PT=8 / PRD=10 / TS=6）：
//   注册 → 建项目 → 工作记录
//   第一环 需求分析：真实对话（诘问 → 四段）→ 需求分析.md
//   第二环 原型：真实对话（提案式访谈 → HTML 快照 → 指正修订 → 完满冻结）→ 原型.md
//   第三环 PRD：真实对话（二次确认 → 概念版 → 范围冻结 → 六章）→ prd.md
//   第四环 任务拆分：真实对话（草案 → quiz 确认 → issues 文件集）
// 结构断言（复用各环独立脚本断言核心）：
//   - 需求分析.md：四段齐全 + 功能范围段含「不做 Y（附理由）」+ 排除清单唯一（03）
//   - 原型.md：五字段（目的/元素/操作/入口·出口/依赖）+ 用户流程 + 显示文案（04）
//   - prd.md：六章齐全 + 第 3/5 章与原型.md 零转换一致 + 外部依赖单源（05）
//   - issues：四字段 + blocked by + 引用非复制 + 编号序（06）
// 数据断言：
//   - 文件树可见性：API 文件列表（文件树数据源）齐全 + DOM 抽查
//   - MongoDB 落库正确：API 中介断言（files/messages/tabs API 即 DB 状态，同各环脚本模式）
//   - 协议标记落库：FILE/HTML/SCOPE_FROZEN 标记完整落在 messages 落库内容中
//   - changelog 头规范：正式文件有 changelog 头、工作文档无
// 幂等：每轮运行注册全新用户（Date.now() 邮箱建号），无需清场；
//       累计测试用户留库为既有脚本一致行为。
// 前置：dev server 运行在 localhost:3000，MongoDB 可连（.env.local 的 MONGODB_URI），
//       默认 AI_MODE=replay；真实模型验证时才需要 AI_MODE=live + AI_API_KEY
// 用法: node scripts/verify-v1-flow.mjs
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";

const email = `verify-flow-${Date.now()}@test.local`;
const password = "verify-pass-1234";
// 每环真实对话轮数上限（控制 token 消耗；实现时与用户确认：收紧 10/8/10/6）
const MAX_ROUNDS = { ra: 10, pt: 8, prd: 10, ts: 6 };
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

// ── 注册 → 项目 → 工作记录（幂等：每轮新用户建号）──────────
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
await page.fill('input[placeholder="输入项目名称"]', "四环全流程验证");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /四环全流程验证/ }).click();
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
check("前置：拿到 project id", !!projectId, `(workRecord=${workRecordId})`);

// ── 共享驱动：四环共用的 tab 创建 / 对话发送 / 消息读取 ─────
const ring = { tabId: "", rawReplies: [] }; // 当前环的 tab 与原始消息（含 markers）

/** API 创建 tab，返回 { status, tab, context }（context = 自动加载断言用） */
async function createTab(agentType) {
  return page.evaluate(
    async ({ wid, agentType }) => {
      const res = await fetch(`/api/work-records/${wid}/tabs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_type: agentType }),
      });
      const data = await res.json();
      return { status: res.status, tab: data.tab, context: (data.context_files ?? []).map((f) => f.filename) };
    },
    { wid: workRecordId, agentType }
  );
}

/** 发送一条消息并等待回复完成。dialogMode:
 *  - "confirm-all"：回复后循环点掉全部「确认写入」弹窗（正式交付物 + 05 队列化）
 *  - "none"：不点弹窗（06 模式：issues 文件集弹窗在循环外按 确认1个+拒绝其余 处理） */
async function sendAndWait(text, roundNo, dialogMode = "confirm-all") {
  console.log(`  [对话] 第 ${roundNo} 轮发送: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
  await page.locator("textarea").fill(text);
  await page.getByRole("button", { name: "发送" }).click();
  // 等待回复完成：textarea 重新可用
  // 720s > route 上游超时 600s（src/app/api/tabs/[id]/chat/route.ts 的 timeout: 600_000）：
  // 停滞时 route 先发错误 SSE 恢复输入框（而非 harness 先崩溃），本环以「重试下一轮」继续，
  // 单次瞬态停滞不杀整轮运行（2026-08-10 决策）。两条超时是一对不变量——改一侧必须同步另一侧，
  // 保持 harness 等待严格大于 route 上游超时（600s 与 SDK 默认一致，覆盖 32K 上限的慢速长输出）。
  await page.waitForFunction(
    () => {
      const ta = document.querySelector("textarea");
      return ta && !ta.disabled;
    },
    null,
    { timeout: 720000 }
  );
  console.log(`  [对话] 第 ${roundNo} 轮回复完成`);
  if (dialogMode === "confirm-all") {
    // 05 队列化模式：同一回复的多个正式文件按序逐个弹确认框，循环点完
    for (let i = 0; i < 10; i++) {
      const confirmBtn = page.getByRole("button", { name: "确认写入" });
      try {
        await confirmBtn.waitFor({ state: "visible", timeout: 4000 });
      } catch {
        break; // 无确认框（本轮回复未产出文件，或队列已全部点完）
      }
      await confirmBtn.click();
      console.log(`  [对话] 第 ${roundNo} 轮点击了「确认写入」`);
      await page.waitForTimeout(1200);
    }
  }
  // 记录当前环所有 assistant 原始消息（含 markers；落库内容 = messages API 返回）
  const msgs = await page.evaluate(async (tid) => {
    const res = await fetch(`/api/tabs/${tid}/messages`);
    const data = await res.json();
    return (data.messages ?? []).filter((m) => m.role === "assistant").map((m) => m.content);
  }, ring.tabId);
  ring.rawReplies.length = 0;
  ring.rawReplies.push(...msgs);
}

/** 当前环对话中累计 HTML 快照数（跨轮累计） */
function htmlCount() {
  return ring.rawReplies.reduce((n, c) => n + (c.split("%%%HTML_BEGIN%%%").length - 1), 0);
}

// ════════════════════════════════════════════════════════════════════
// 第一环：需求分析（诘问式 → 四段 → 需求分析.md）
// ════════════════════════════════════════════════════════════════════
console.log("\n── 第一环：需求分析 ──────────────────────────────");
const raCreated = await createTab("requirement_analyst");
check("创建需求分析 tab 成功", raCreated.status === 201, `(status=${raCreated.status})`);
ring.tabId = raCreated.tab?.id ?? raCreated.tab?._id;
check("拿到 tab id", !!ring.tabId, `(实际=${JSON.stringify(raCreated.tab)?.slice(0, 120)})`);

// 激活该 tab（API 创建的 tab 需先刷新页面；TabBar 的 tab 是 div 而非 button）
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByText("需求分析 #1", { exact: true }).first().click();
await page.waitForTimeout(600);

// 素材覆盖：目标用户/场景/痛点/功能想法/确定不做——让 Agent 少问多推（同 03）
const RA_OPENING =
  "我有一个产品想法，请开始需求分析。\n想法：校园二手交易平台。\n" +
  "目标用户：本校大学生。使用场景：毕业季清理闲置、日常买卖二手书和生活用品。\n" +
  "当前痛点：只能靠微信群发图卖二手，无检索、无信用体系、交易全靠私聊。\n" +
  "功能想法：商品发布、分类浏览搜索、站内私聊、用户评价。\n" +
  "四条功能需求均已确认保留，无需再逐条取舍验证，请直接完成四段分析并输出文档。\n" +
  "确定不做：不搞物流配送、不做担保交易、不做移动 App 只做网页。\n请开始。";
const RA_PUSH_POOL = [
  "我们已经讨论得比较充分了。请汇总结论：补齐四段分析（用户与场景/用户故事/功能范围/成功指标），把确定不做的列入排除清单，然后输出需求分析.md。",
  "请继续推进：把确认的结论整理成完整的需求分析文档输出。",
];
/** 引导式应答：按 Agent 本轮回复的关键词给出针对性回答（同 03，模拟配合的新手用户） */
let lastReplyBranch = "";
function replyFor(lastContent) {
  // 尾段强推（在 generic 分支之前）：Agent 回复常以「XX 已确认。我们继续推进…」开场，
  // 若落入 generic「已确认」分支，回复无实质推进内容，10 轮会耗在逐项复述上。
  // Agent 指出需求未裁决（卡点）：显式裁决四条需求全部保留并直接要求输出
  if (/(私聊|评价).{0,40}(未|待定|尚未|无法|需要.{0,6}裁决)/.test(lastContent)) {
    return "确认：站内私聊、用户评价与发布、搜索一样都保留（四条功能需求均已确认保留）。所有结论已确认完毕，请直接输出完整的需求分析.md。";
  }
  // 四段分析对齐阶段（含最后一项）：确认 + 明确要求对齐后直接输出文档
  if (/四段分析对齐|最后一项|第 4 项/.test(lastContent)) {
    return "确认。四段结论按已确认内容来，请逐项对齐后直接输出完整的需求分析.md。";
  }
  if (/成功指标/.test(lastContent)) {
    return "确认，成功指标没问题。四段分析已全部对齐，请基于所有已确认结论直接输出完整的需求分析.md。";
  }
  const branches = [
    [/已收到|重复|无需修改|已完整/, "recorded", "好的，这条已确认，请继续推进下一步。"],
    [/首页|形态|布局/, "home", "好，按你建议的来。请继续推进下一步。"],
    [/卖方|买方|10个学生|画像/, "priority", "卖方优先吧，发布是核心，先解决有没有货的问题。"],
    [/频率|多久|高频|低频/, "freq", "商品发布和搜索是高频（毕业季几乎每天），私聊中频，评价中频。"],
    [/取舍|保留|排除|不做|真实/, "triage", "四条功能需求（发布/搜索/私聊/评价）都保留，按你的分析来。明确排除：物流配送、担保交易、移动 App。"],
    [/场景|目标用户|用户与场景/, "scene", "就是本校学生，毕业季清理闲置、日常买卖二手，现在靠微信群。"],
    [/功能范围|做 X|MVP|优先级/, "scope", "功能就做：商品发布、分类浏览搜索、站内私聊、用户评价，发布和搜索是 P0。"],
    [/成功指标|衡量/, "metric", "成功指标：上线 1 个月内发布商品 100 件、完成交易 30 笔。"],
    [/用户故事|作为/, "story", "是，用户故事按你复述的来。"],
    [/确认|可以吗|对吗|对吧|理解得对吗|没问题/, "confirm", "确认，没问题。按你推荐的方向来，请继续推进下一步。"],
    [/输出|写入|汇总|收尾|需求分析/, "write", "确认，请输出需求分析.md。"],
  ];
  for (const [re, key, answer] of branches) {
    if (re.test(lastContent)) {
      if (key === lastReplyBranch) return "好的，请继续推进下一步。";
      lastReplyBranch = key;
      return answer;
    }
  }
  lastReplyBranch = "default";
  return "确认，请继续推进。";
}

await sendAndWait(RA_OPENING, 1);
let raFinished = false;
for (let i = 0; i < MAX_ROUNDS.ra - 1; i++) {
  const last = ring.rawReplies[ring.rawReplies.length - 1] ?? "";
  // 已产出需求分析.md（精确匹配 marker + 文件名——工作文档 marker 也含 FILE_BEGIN）
  if (/%%%FILE_BEGIN%%%\s*需求分析\.md/.test(last)) {
    raFinished = true;
    break;
  }
  let text;
  if (/(私聊|评价).{0,40}(未|待定|尚未|无法|需要.{0,6}裁决)/.test(last)) {
    // Agent 指出需求未裁决（卡点）：显式裁决四条需求全部保留并直接要求输出
    text = "确认：站内私聊、用户评价与发布、搜索一样都保留（四条功能需求均已确认保留）。所有结论已确认完毕，请直接输出完整的需求分析.md。";
  } else {
    text = i >= 3 && !/[？?]/.test(last) ? RA_PUSH_POOL[i % RA_PUSH_POOL.length] : replyFor(last);
  }
  await sendAndWait(text, i + 2);
}
// 最后一轮（第 MAX_ROUNDS 轮）sendAndWait 完成后循环即退出，补一次 marker 检测
{
  const last = ring.rawReplies[ring.rawReplies.length - 1] ?? "";
  if (/%%%FILE_BEGIN%%%\s*需求分析\.md/.test(last)) raFinished = true;
}

// ── 第一环断言：结构与数据（03 断言核心）──────────────
const raFiles = await page.evaluate(async (pid) => {
  const res = await fetch(`/api/projects/${pid}/files`);
  return res.json();
}, projectId);
const fileByName = (name) => raFiles.find((f) => f.filename.includes(name));

async function readRaw(pid, file) {
  const data = await page.evaluate(async ({ pid, fid }) => {
    const res = await fetch(`/api/projects/${pid}/files/${fid}`);
    const d = await res.json();
    return d.content ?? "";
  }, { pid, fid: file.id ?? file._id });
  return data;
}
/** 剥离 changelog 头（同 stripChangelogHeader） */
const stripChangelog = (content) => content.replace(/^<!--\nchangelog:[\s\S]*?-->\n?/, "");

const raDoc = fileByName("需求分析.md");
check("需求分析.md 已产出并出现在文件树", !!raDoc, `(文件列表=${raFiles.map((f) => f.filename).join("、")})`);

if (raDoc) {
  const raBody = stripChangelog(await readRaw(projectId, raDoc));
  for (const s of ["用户与场景", "用户故事", "功能范围", "成功指标"]) {
    check(`需求分析.md 含「${s}」段（四段完整性）`, raBody.includes(s));
  }
  // 排除项断言收紧：限定在「功能范围」段内，且排除项附理由（03）
  const scopeMatch = raBody.match(/### 功能范围\n([\s\S]*?)(?=\n### |\n# 排除清单|$)/);
  const scopeSection = scopeMatch ? scopeMatch[1] : "";
  check("功能范围段内含排除项（不做 Y）", /不做|排除/.test(scopeSection), `(段内容=${scopeSection.slice(0, 60)})`);
  // 排除项附理由：整段扫「不做/排除 … 因为/理由/（/—」同行形态（同 03 断言核心；
  // 不用逐条捕获——Agent 条目格式有波动（如 **不做 X：** 加粗），逐条捕获易误伤）
  check(
    "功能范围段排除项附理由",
    /(?:不做|排除)[^。\n]*(?:因为|理由|（|—)/.test(scopeSection),
    `(段内容=${scopeSection.slice(0, 120)})`
  );
  check("「# 排除清单」段恰好出现一次", (raBody.match(/# 排除清单/g) ?? []).length === 1);
  check("需求分析.md 有 changelog 头（正式文件规范）", /^<!--\nchangelog:/.test(await readRaw(projectId, raDoc)));
}

// 工作文档：出现在文件树 + 无 changelog 头 + 不可加载进 Agent 上下文
// （07 决策 2026-08-10：文件树断言降为 WARN——RA_OPENING 强推话术会让 Agent 跳过工作文档
//   直接输出需求分析.md；工作文档机制已由 03 独立脚本 verify-requirement-analyst-discipline.mjs
//   完整验证，flow 脚本职责是链式走通，ticket 07 结构断言仅要求「功能范围段含排除项」）
const workDoc = fileByName("工作文档");
warn("工作文档出现在文件树（需求分析-工作文档（…）.md）", `(文件列表=${raFiles.map((f) => f.filename).join("、")})`);
if (workDoc) {
  check("工作文档无 changelog 头（中间快照规范）", !/^<!--\nchangelog:/.test(await readRaw(projectId, workDoc)));
  const loadRes = await page.evaluate(async ({ tid, fid }) => {
    const res = await fetch(`/api/tabs/${tid}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fid }),
    });
    return { status: res.status };
  }, { tid: ring.tabId, fid: workDoc.id ?? workDoc._id });
  check("工作文档不可加载进上下文（POST 400）", loadRes.status === 400, `(status=${loadRes.status})`);
}
check("需求分析环对话中输出 FILE marker（落库）", raFinished, `(末轮片段=${(ring.rawReplies[ring.rawReplies.length - 1] ?? "").slice(0, 80).replace(/\n/g, " ")})`);
// 保存本环回复快照（对话纪律与诊断用；下一环 sendAndWait 会重置 ring.rawReplies）
const raReplies = ring.rawReplies.slice();

// ════════════════════════════════════════════════════════════════════
// 第二环：原型（提案式访谈 → HTML 快照 → 指正修订 → 完满冻结 → 原型.md）
// ════════════════════════════════════════════════════════════════════
console.log("\n── 第二环：原型 ────────────────────────────────");
const ptCreated = await createTab("prototype");
check("创建原型 tab 成功", ptCreated.status === 201, `(status=${ptCreated.status})`);
ring.tabId = ptCreated.tab?.id ?? ptCreated.tab?._id;
check(
  "原型 tab 自动加载 需求分析.md",
  (ptCreated.context ?? []).some((f) => f.includes("需求分析.md")),
  `(context=${JSON.stringify(ptCreated.context)})`
);

await page.reload();
await page.waitForLoadState("networkidle");
await page.getByText("原型 #1", { exact: true }).first().click();
await page.waitForTimeout(600);

const PT_OPENING =
  "请开始原型设计。\n" +
  "产品：校园二手交易平台（需求分析.md 已加载，请基于它）。\n" +
  "核心功能：商品发布、分类浏览搜索、站内私聊、用户评价；发布与搜索是 P0。\n" +
  "不做：物流配送、担保交易。\n" +
  "请先给出你的整体方案（页面清单 + 用户流程），并生成 HTML 原型快照。";
const PT_CORRECTION =
  "整体方向可以。请修订一处：发布流程太繁琐，把「发布商品」合并为单页表单（标题、描述、价格、图片一步填完），去掉分步填写。请修订结构化文本并重新生成 HTML 原型快照。";

await sendAndWait(PT_OPENING, 1);
let ptFinished = false;
let correctionSent = false;
for (let i = 0; i < MAX_ROUNDS.pt - 1; i++) {
  const last = ring.rawReplies[ring.rawReplies.length - 1] ?? "";
  // 已产出原型.md（精确匹配 marker + 文件名）
  if (/%%%FILE_BEGIN%%%\s*原型\.md/.test(last)) {
    // 04 已知 LLM 波动：Agent 偶发跳过 %%%SCOPE_FROZEN%%% 冻结标记直接输出原型.md
    //（route 冻结门 = 「Agent 回复含标记」+「用户消息命中肯定词」双条件）。
    // 纠正一轮：重申「完满」（命中 SCOPE_FREEZE_CONFIRM_RE）+ 要求补全冻结序列。
    if (!/%%%SCOPE_FROZEN%%%/.test(ring.rawReplies.join(""))) {
      await sendAndWait(
        "完满。你直接输出了原型.md，但缺少 %%%SCOPE_FROZEN%%% 范围冻结标记——请先输出自检清单与 %%%SCOPE_FROZEN%%% 标记，再输出原型.md。",
        i + 2
      );
      ptFinished = /%%%FILE_BEGIN%%%\s*原型\.md/.test(ring.rawReplies[ring.rawReplies.length - 1] ?? "");
    } else {
      ptFinished = true;
    }
    break;
  }
  const hCount = htmlCount();
  let text;
  if (hCount === 0) {
    text = "请先给出整体方案（页面清单 + 用户流程）并生成 HTML 原型快照。";
  } else if (!correctionSent) {
    text = PT_CORRECTION;
    correctionSent = true;
  } else if (hCount < 2) {
    text = "修订意见如上，请修订并重新生成 HTML 原型快照。";
  } else {
    text = "完满。请按自检清单检查后输出原型.md。";
  }
  await sendAndWait(text, i + 2);
}
// 最后一轮（第 MAX_ROUNDS 轮）sendAndWait 完成后循环即退出，补一次 marker 检测
{
  const last = ring.rawReplies[ring.rawReplies.length - 1] ?? "";
  if (/%%%FILE_BEGIN%%%\s*原型\.md/.test(last)) ptFinished = true;
}

// ── 第二环断言：结构与数据（04 断言核心）──────────────
const ptHtmlCount = htmlCount();
check("对话中出现 HTML 原型快照（≥1 次）", ptHtmlCount >= 1, `(实际 ${ptHtmlCount} 次)`);
check("指正后重新生成 HTML 快照（≥2 次，确认闭环）", ptHtmlCount >= 2, `(实际 ${ptHtmlCount} 次)`);

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
    // 内容断言：单文件 HTML（浏览器可打开），首行不被 marker 解析吞掉
    const stream = await download.createReadStream();
    let body = "";
    for await (const chunk of stream) body += chunk.toString();
    const htmlOk = /^(<!doctype html|<html)/i.test(body.trimStart().slice(0, 200));
    check("下载内容为单文件 HTML（首行完整）", htmlOk, `(内容开头=${body.slice(0, 80).replace(/\n/g, " ")})`);
  } catch (e) {
    dlDetail += ` download 事件异常: ${e?.message?.slice(0, 80) ?? e}`;
  }
  check("点击下载按钮触发下载（.html 文件）", dlOk, `(${dlDetail})`);
}

// 冻结：tab.scope_frozen = true（「完满」肯定词通过 SCOPE_FREEZE_CONFIRM_RE）
const ptTabsInfo = await page.evaluate(async (wid) => {
  const res = await fetch(`/api/work-records/${wid}/tabs`);
  return res.json();
}, workRecordId);
const ptTab = (Array.isArray(ptTabsInfo) ? ptTabsInfo : (ptTabsInfo.tabs ?? [])).find((t) => t.agent_type === "prototype");
check("「完满」确认后 tab.scope_frozen = true", ptTab?.scope_frozen === true, `(实际=${JSON.stringify(ptTab?.scope_frozen)})`);

const ptLast = ring.rawReplies[ring.rawReplies.length - 1] ?? "";
check("Agent 输出原型.md（FILE marker）", ptFinished, `(末轮回复=${ptLast.slice(0, 80).replace(/\n/g, " ")})`);
check("冻结前展示自检清单（自检/核对条目）", /自检|核对|检查清单|- \[x\]/.test(ring.rawReplies.join("")));

const ptFiles = await page.evaluate(async (pid) => {
  const res = await fetch(`/api/projects/${pid}/files`);
  return res.json();
}, projectId);
const ptDoc = ptFiles.find((f) => f.filename.includes("原型.md"));
check("原型.md 落盘并出现在文件树", !!ptDoc, `(文件列表=${ptFiles.map((f) => f.filename).join("、")})`);
if (ptDoc) {
  const ptBody = stripChangelog(await readRaw(projectId, ptDoc));
  for (const f of ["目的", "元素", "操作", "入口·出口", "依赖"]) {
    check(`原型.md 页面清单含「${f}」（五字段）`, ptBody.includes(f));
  }
  check("原型.md 含「用户流程」段", ptBody.includes("用户流程"));
  const hasCopy = /显示文案|「[^」]{1,20}」/.test(ptBody);
  check("原型.md 元素含显示文案", hasCopy, `(片段=${ptBody.slice(0, 200).replace(/\n/g, " ")})`);
  check("原型.md 有 changelog 头（正式文件规范）", /^<!--\nchangelog:/.test(await readRaw(projectId, ptDoc)));
}
const ptReplies = ring.rawReplies.slice(); // 本环回复快照（下一环 sendAndWait 会重置）

// ════════════════════════════════════════════════════════════════════
// 第三环：PRD（二次确认 → 概念版 → 范围冻结 → 六章 → prd.md）
// ════════════════════════════════════════════════════════════════════
console.log("\n── 第三环：PRD ─────────────────────────────────");
const prdCreated = await createTab("mvp_prd");
check("创建 PRD tab 成功", prdCreated.status === 201, `(status=${prdCreated.status})`);
ring.tabId = prdCreated.tab?.id ?? prdCreated.tab?._id;
const prdCtxNames = prdCreated.context ?? [];
check(
  "PRD tab 自动加载 需求分析.md + 原型.md",
  prdCtxNames.includes("需求分析.md") && prdCtxNames.includes("原型.md"),
  `(context=${JSON.stringify(prdCtxNames)})`
);

await page.reload();
await page.waitForLoadState("networkidle");
await page.getByText("MVP-PRD #1", { exact: true }).first().click();
await page.waitForTimeout(600);

const PRD_OPENING =
  "请基于已加载的需求分析.md 和原型.md 开始撰写 PRD。\n" +
  "流程请按你的规范走：先二次确认需求分析结论，再概念版与范围冻结，然后详细撰写六章。";
await sendAndWait(PRD_OPENING, 1);

let conceptRound = -1; // 概念版轮次（1-based）
let prdFinished = false;
for (let i = 0; i < MAX_ROUNDS.prd - 1; i++) {
  const last = ring.rawReplies[ring.rawReplies.length - 1] ?? "";
  // 已产出 prd.md（六章齐全文档）——完成
  if (/%%%FILE_BEGIN%%%\s*prd\.md/.test(last)) {
    prdFinished = true;
    break;
  }
  let text;
  // 概念版输出轮判定要精确：二次确认轮也可能提「概念版」字样（流程预告），
  // 只有「**概念版** + 外部依赖声明」同时出现才说明概念版真正落到了回复里
  if (conceptRound === -1 && /外部依赖声明/.test(last) && /概念版/.test(last)) {
    conceptRound = ring.rawReplies.length;
    // 明确要求概念版先落盘为独立文件（prompt 规定用户确认后同一回复完成三件事：
    // 概念版文件 + SCOPE_FROZEN + 冻结；若只回「开始详细撰写」，Agent 可能跳过文件直接撰写）
    text = "确认。范围没问题。请先把概念版写入独立文件供回看，再冻结范围，然后开始详细撰写。";
  } else if (/%%%FILE_BEGIN%%%/.test(last)) {
    text = "继续。";
  } else {
    // 复述确认 / grilling 补缺 / 验收标准确认——确认 + 授权推断未决决策点
    text = "确认，没有遗漏。所有未决业务决策点授权你按合理默认值推断并在文档中标注为推断值；按你的方案继续。";
  }
  await sendAndWait(text, i + 2);
}
// 最后一轮（第 MAX_ROUNDS 轮）sendAndWait 完成后循环即退出，补一次 marker 检测
{
  const last = ring.rawReplies[ring.rawReplies.length - 1] ?? "";
  if (/%%%FILE_BEGIN%%%\s*prd\.md/.test(last)) prdFinished = true;
}

// ── 第三环断言：结构与数据（05 断言核心）──────────────
const prdAllReplies = ring.rawReplies.join("\n");
check(
  "二次确认轮：Agent 复述需求分析结论（不重新讨论）",
  /二手|商品|学生|平台|交易/.test(ring.rawReplies[0] ?? ""),
  `(首轮回复=${(ring.rawReplies[0] ?? "").slice(0, 120).replace(/\n/g, " ")})`
);
check(
  "对话中出现概念版（含外部依赖声明）",
  conceptRound !== -1 && /外部依赖/.test(prdAllReplies),
  `(概念版轮次=${conceptRound})`
);
if (conceptRound !== -1) {
  const conceptReply = ring.rawReplies[conceptRound - 1] ?? "";
  const fields = ["核心用户", "要解决的一件事", "产品形态", "MVP 功能", "本版本不做什么", "商业模式", "外部依赖声明"];
  const missing = fields.filter((f) => !conceptReply.includes(f));
  check("概念版格式字段齐全", missing.length === 0, `(缺 ${missing.join("、") || "无"})`);
  const m = conceptReply.match(/\*\*概念版\*\*([\s\S]*?)(?:以上范围是否确认)/);
  const conceptText = (m ? m[1].trim() : conceptReply) ?? "";
  check("概念版 ≤300 字", conceptText.length <= 650, `(实际 ${conceptText.length} 字符，含格式外壳；核心内容应 ≤300 字)`);
}
check(
  "Agent 输出 %%%SCOPE_FROZEN%%% 标记（范围冻结）",
  prdAllReplies.includes("%%%SCOPE_FROZEN%%%"),
  `(末轮片段=${(ring.rawReplies[ring.rawReplies.length - 1] ?? "").slice(0, 80).replace(/\n/g, " ")})`
);

const prdTabsInfo = await page.evaluate(async (wid) => {
  const res = await fetch(`/api/work-records/${wid}/tabs`);
  return res.json();
}, workRecordId);
const prdTab = (Array.isArray(prdTabsInfo) ? prdTabsInfo : (prdTabsInfo.tabs ?? [])).find((t) => t.agent_type === "mvp_prd");
check("范围冻结确认后 tab.scope_frozen = true", prdTab?.scope_frozen === true, `(实际=${JSON.stringify(prdTab?.scope_frozen)})`);

const prdFiles = await page.evaluate(async (pid) => {
  const res = await fetch(`/api/projects/${pid}/files`);
  return res.json();
}, projectId);
const conceptDoc = prdFiles.find((f) => f.filename.includes("概念版"));
check(
  "概念版落盘为文件树独立文件「概念版（…）.md」",
  !!conceptDoc && /^概念版.*\.md$/.test(conceptDoc.filename),
  `(文件列表=${prdFiles.map((f) => f.filename).join("、")})`
);
if (conceptDoc) {
  const loadRes = await page.evaluate(async ({ tid, fid }) => {
    const res = await fetch(`/api/tabs/${tid}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fid }),
    });
    return { status: res.status };
  }, { tid: ring.tabId, fid: conceptDoc.id ?? conceptDoc._id });
  check("概念版不可加载进 Agent 上下文（POST 400）", loadRes.status === 400, `(status=${loadRes.status})`);
  check("概念版有 changelog 头（正式文件规范）", /^<!--\nchangelog:/.test(await readRaw(projectId, conceptDoc)));
}

check("Agent 输出 prd.md（FILE marker）", prdFinished, `(末轮回复=${(ring.rawReplies[ring.rawReplies.length - 1] ?? "").slice(0, 80).replace(/\n/g, " ")})`);
const prdDoc = prdFiles.find((f) => f.filename === "prd.md");
check("prd.md 落盘并出现在文件树", !!prdDoc, `(文件列表=${prdFiles.map((f) => f.filename).join("、")})`);

const prdBody = prdDoc ? stripChangelog(await readRaw(projectId, prdDoc)) : "";
const protoBody = ptDoc ? stripChangelog(await readRaw(projectId, ptDoc)) : "";

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
check("prd.md 有 changelog 头（正式文件规范）", prdDoc ? /^<!--\nchangelog:/.test(await readRaw(projectId, prdDoc)) : false);

// 第 3、5 章与原型.md 零转换一致性：原型.md 每个「## 页面名」块 ∈ 第 3 章；
// 每个「## 用户流程：[场景]」块 ∈ 第 5 章（结构措辞原样，不重写）
/**
 * 零转换一致性校验：原型.md 每个内容块必须逐字出现在 prd.md 第 3/5 章中。
 * 兼容两种合法格式（模型输出不稳定）：
 *   A)「## 页面清单」+「### 首页」/「## 用户流程」+「### 用户流程：买家找货」
 *   B)「## 首页」/「## 用户流程：买家找货」直接二级标题（prompt 模板格式）
 * prd.md 侧二级标题带章节号（「## 3. 页面清单」），按「### 」子块 / 「## 页面名」块
 * 比较即可忽略章节号差异；第 5 章在每个流程块后追加「#### 验收标准」，不影响
 * 块原文的包含关系。归类：块标题或所属容器含「用户流程」→ 流程块 ∈ 第 5 章；
 * 其余 → 页面块 ∈ 第 3 章。空容器（「## 页面清单」/「## 用户流程」单独成块）不参与校验。
 */
/** 块标题归一化：剥掉中文编号前缀（「## 一、页面清单」→「## 页面清单」）——
 *  原型.md 标题编号格式有波动（04 真实对话产物：无编号 / 一、二、等），
 *  分类只看语义容器/流程，不看编号 */
const normTitle = (t) => t.replace(/^(##\s*)[一二三四五六七八九十]+[、.．]?\s*/, "$1");

function splitProtoBlocks(body) {
  const top = [];
  let cur = null;
  let sub = null;
  const closeSub = () => {
    if (sub) {
      cur.subs.push(sub);
      sub = null;
    }
  };
  const closeTop = () => {
    if (cur) {
      closeSub();
      top.push(cur);
      cur = null;
    }
  };
  for (const line of body.split("\n")) {
    if (/^---\s*$/.test(line)) continue; // 水平分隔线（原型.md 块间分隔；prd.md 无）不参与校验
    if (/^# /.test(line)) {
      closeTop(); // 一级标题段（如原型.md 末尾「# 排除清单」）非页面/流程块，跳过
      continue;
    }
    if (/^## /.test(line)) {
      closeTop();
      cur = { title: line, text: line, subs: [] };
    } else if (/^### /.test(line)) {
      if (cur) {
        closeSub();
        cur.text += "\n" + line;
        sub = { title: line, text: line };
      }
    } else if (cur) {
      cur.text += "\n" + line;
      if (sub) sub.text += "\n" + line;
    }
  }
  closeTop();
  return top;
}
const ch3 = prdBody.match(/##\s*3[.、]\s*页面清单[\s\S]*?(?=##\s*4[.、])/)?.[0] ?? "";
const ch5 = prdBody.match(/##\s*5[.、]\s*用户流程[\s\S]*?(?=##\s*6[.、])/)?.[0] ?? "";
const protoBlocks = splitProtoBlocks(protoBody);
let pageMismatch = 0;
let flowMismatch = 0;
let pageCount = 0;
let flowCount = 0;
for (const top of protoBlocks) {
  if (top.subs.length === 0) {
    // 空容器（「## 页面清单」/「## 用户流程」，可带编号前缀）与排除项段（排除项在
    // prd.md 第 2 章而非第 3/5 章）不参与校验
    const nt = normTitle(top.title);
    if (nt === "## 页面清单" || nt === "## 用户流程" || /^## .*排除/.test(nt)) continue;
    const text = top.text.trim();
    // 内容标记白名单（黑名单打地鼠修了三轮变体：排除项段/中文编号/依赖段 → 换白名单）：
    // 页面块必有五字段标记（目的/元素/操作/入口·出口/依赖），流程块标题必含「用户流程」
    const isFlow = nt.startsWith("## 用户流程");
    if (!isFlow && !/\*\*目的\*\*|\*\*元素\*\*/.test(text)) continue;
    if (isFlow) {
      flowCount++;
      if (!ch5.includes(text)) flowMismatch++;
    } else {
      pageCount++;
      if (!ch3.includes(text)) pageMismatch++;
    }
  } else {
    for (const b of top.subs) {
      const text = b.text.trim();
      const isFlow = normTitle(b.title).startsWith("## 用户流程") || normTitle(top.title).startsWith("## 用户流程");
      if (isFlow) {
        flowCount++;
        if (!ch5.includes(text)) flowMismatch++;
      } else {
        pageCount++;
        if (!ch3.includes(text)) pageMismatch++;
      }
    }
  }
}
check(
  "第 3 章 = 原型.md 页面清单段原文（零转换嵌入）",
  pageMismatch === 0 && pageCount > 0,
  `(不一致块 ${pageMismatch} 个；原型.md 页面块=${pageCount})`
);
check(
  "第 5 章 = 原型.md 用户流程段原文（零转换嵌入）",
  flowMismatch === 0 && flowCount > 0,
  `(不一致块 ${flowMismatch} 个；原型.md 流程块=${flowCount})`
);

// 外部依赖声明只在概念章出现一次（spec US31 单源）；概念版内容不写入 prd.md
const afterCh1 = prdBody.replace(/##\s*1[.、]\s*概念[\s\S]*?(?=##\s*2[.、])/, "");
check(
  "外部依赖声明只在概念章出现一次（单源）",
  /##\s*1[.、]\s*概念[\s\S]*外部依赖/.test(prdBody) && !afterCh1.includes("外部依赖声明"),
  `(第 2-6 章含「外部依赖声明」=${afterCh1.includes("外部依赖声明")}; 纯措辞引用「与外部依赖声明自洽」不视为重复声明)`
);
check("概念版内容不写入 prd.md", !prdBody.includes("概念版"), `(prd.md 含「概念版」=${prdBody.includes("概念版")})`);
const prdReplies = ring.rawReplies.slice(); // 本环回复快照（下一环 sendAndWait 会重置）

// ════════════════════════════════════════════════════════════════════
// 第四环：任务拆分（草案 → quiz 确认 → issues 文件集）
// ════════════════════════════════════════════════════════════════════
console.log("\n── 第四环：任务拆分 ────────────────────────────");
const tsCreated = await createTab("ticket_splitter");
check("创建任务拆分 tab 成功", tsCreated.status === 201, `(status=${tsCreated.status})`);
ring.tabId = tsCreated.tab?.id ?? tsCreated.tab?._id;
const tsCtxNames = tsCreated.context ?? [];
check(
  "任务拆分 tab 自动加载 prd.md + 需求分析.md",
  tsCtxNames.includes("prd.md") && tsCtxNames.includes("需求分析.md"),
  `(context=${JSON.stringify(tsCtxNames)})`
);

await page.reload();
await page.waitForLoadState("networkidle");
await page.getByText("任务拆分 #1", { exact: true }).first().click();
await page.waitForTimeout(600);

const TS_OPENING =
  "请基于已加载的 prd.md 把 PRD 拆分为 issues 文件集。" +
  "按你的流程走：先出切分草案，再确认。";
await sendAndWait(TS_OPENING, 1, "none"); // issues 弹窗在循环外按 确认1个+拒绝其余 处理

let tsFinished = false;
for (let i = 0; i < MAX_ROUNDS.ts - 1; i++) {
  const last = ring.rawReplies[ring.rawReplies.length - 1] ?? "";
  if (/%%%FILE_BEGIN%%%\s*issues\//.test(last)) {
    tsFinished = true;
    break;
  }
  let text;
  if (/%%%FILE_BEGIN%%%/.test(last)) {
    text = "继续。";
  } else if (i === 0 && /Blocked by|交付行为|粒度/.test(last)) {
    text = "可以。粒度合适，blocking edges 没问题，不需要合并拆分。请输出 issues 文件集。";
  } else {
    text = "确认，按你的方案拆分，请输出 issues 文件集。";
  }
  await sendAndWait(text, i + 2, "none");
}
// 最后一轮（第 MAX_ROUNDS 轮）sendAndWait 完成后循环即退出，补一次 marker 检测
{
  const last = ring.rawReplies[ring.rawReplies.length - 1] ?? "";
  if (/%%%FILE_BEGIN%%%\s*issues\//.test(last)) tsFinished = true;
}

// ── 第四环断言：结构与数据（06 断言核心）──────────────
const tsAllReplies = ring.rawReplies.join("\n");
check(
  "对话中出现切分草案（标题/Blocked by/交付行为三要素）",
  /Blocked by/.test(tsAllReplies) && /交付行为|What to build/.test(tsAllReplies),
  `(对话长度=${tsAllReplies.length})`
);
check("Agent 输出 issues 文件集（FILE markers 指向 issues/ 子路径）", tsFinished);

// 提取输出轮的所有 issue 文件名（按序）
let issueFilenames = [];
if (tsFinished) {
  const issuesReply = [...ring.rawReplies].reverse().find((c) => /%%%FILE_BEGIN%%%\s*issues\//.test(c)) ?? "";
  issueFilenames = [...new Set([...issuesReply.matchAll(/%%%FILE_BEGIN%%%\s*(issues\/[^\n]+\.md)/g)].map((m) => m[1].trim()))];
}
check("一次输出多个 issue 文件（≥2）", issueFilenames.length >= 2, `(文件=${issueFilenames.join("、") || "无"})`);
check("文件名格式 issues/NN-<slug>.md", issueFilenames.every((f) => /^issues\/\d{2}-.+\.md$/.test(f)), `(文件=${issueFilenames.join("、") || "无"})`);
const nums = issueFilenames.map((f) => parseInt(f.match(/^issues\/(\d{2})-/)[1], 10));
check(
  "编号从 01 起递增且无跳号",
  nums.length >= 2 && nums[0] === 1 && nums.every((n, idx) => idx === 0 || n === nums[idx - 1] + 1),
  `(编号=${nums.join(",") || "无"})`
);

// 逐个确认/拒绝：第一个「确认写入」，其余「取消」（拒绝的不落盘）
let confirmedCount = 0;
let cancelledCount = 0;
if (tsFinished) {
  try {
    const confirmBtn = page.getByRole("button", { name: "确认写入" }).first();
    await confirmBtn.waitFor({ state: "visible", timeout: 8000 });
    await confirmBtn.click();
    confirmedCount++;
    console.log("  [确认框] 第 1 个 issue 已确认写入");
    await page.waitForTimeout(800);
  } catch {
    console.log("  [确认框] 未检测到确认弹窗（视作失败，走后续断言）");
  }
  while (true) {
    try {
      const confirmBtn = page.getByRole("button", { name: "确认写入" }).first();
      await confirmBtn.waitFor({ state: "visible", timeout: 2500 });
    } catch {
      break;
    }
    await page.getByRole("button", { name: "取消" }).first().click();
    cancelledCount++;
    console.log(`  [确认框] 第 ${confirmedCount + cancelledCount} 个 issue 已取消（拒绝）`);
    await page.waitForTimeout(600);
  }
}
check("确认框逐个弹出（确认 1 个 + 拒绝 ≥1 个）", confirmedCount >= 1 && cancelledCount >= 1, `(确认=${confirmedCount}，拒绝=${cancelledCount})`);

const tsFiles = await page.evaluate(async (pid) => {
  const res = await fetch(`/api/projects/${pid}/files`);
  return res.json();
}, projectId);
const issueDocs = tsFiles.filter((f) => /^issues\//.test(f.filename));
check(
  "只有确认的 issue 落盘（拒绝的不落盘）",
  issueDocs.length === 1,
  `(落盘=${issueDocs.map((f) => f.filename).join("、") || "无"}; 期望仅 ${issueFilenames[0] ?? "第一个"})`
);

if (issueDocs.length === 1) {
  const doc = issueDocs[0];
  const body = stripChangelog(await readRaw(projectId, doc));
  const fields = [
    ["What to build", /^\*\*What to build:\*\*/m],
    ["Blocked by", /^\*\*Blocked by:\*\*/m],
    ["Status: ready-for-agent", /^\*\*Status:\*\*\s*ready-for-agent/m],
    ["验收标准（AC）", /^- \[ \] /m],
  ];
  for (const [name, re] of fields) {
    check(`issue 四字段：${name}`, re.test(body), `(正文头 80 字=${body.slice(0, 80).replace(/\n/g, " ")})`);
  }
  check("issue 标题 # NN —", /^# \d{2} — /m.test(body), `(应含「# 01 — …」标题)`);
  // 引用格式校验：出现 prd.md 章节引用时必须为「（见/引自/详见/参考/引用…）prd.md 第 X 章」
  // 格式（纯 UI 切片无引用合规）。prompt 意图是「引用章节而非复制内容」，措辞允许变体；
  // 仍要求明确章节号（不带章节号的模糊引用不算）。
  const prdRefs = [...body.matchAll(/(?:见|引自|详见|参考|引用|依据)\s*prd\.md\s*第\s*\d+\s*章/g)].map((m) => m[0]);
  check(
    "issue 引用 prd.md 章节（若有引用则格式为「（见/引自…）prd.md 第 X 章」）",
    prdRefs.every((r) => /^(?:见|引自|详见|参考|引用|依据) prd\.md 第 \d+ 章$/.test(r)),
    `(引用=${prdRefs.join("、") || "无"})`
  );
  if (/^issues\/01-/.test(doc.filename)) {
    const blockedByLine = (body.match(/^\*\*Blocked by:\*\* (.+)$/m) ?? [])[1] ?? "";
    check("首个 issue（01）无阻塞依赖", /None|无/.test(blockedByLine), `(Blocked by=${blockedByLine.slice(0, 60)})`);
  }
  check("issue 有 changelog 头（正式文件规范）", /^<!--\nchangelog:/.test(await readRaw(projectId, doc)));

  // 引用非复制（06）：prd.md 长行不得整段出现在 issue 正文（AC 行「- [ ]」除外——
  // prompt 明确要求 AC 直接从第 5 章带走，整行复制是合规行为）
  if (prdDoc) {
    const prdLongLines = prdBody.split("\n").map((l) => l.trim()).filter((l) => l.length > 40 && !l.startsWith("- [ ]"));
    const copiedLines = prdLongLines.filter((l) => body.includes(l));
    check(
      "引用非复制：prd.md 长行未整段复制进 issue",
      copiedLines.length === 0,
      `(复制行 ${copiedLines.length} 条: ${copiedLines.slice(0, 2).join(" || ").slice(0, 100)})`
    );
  }
}
const tsReplies = ring.rawReplies.slice(); // 本环回复快照（供对话纪律与诊断）

// ════════════════════════════════════════════════════════════════════
// 数据断言汇总：文件树可见性 / 协议标记落库 / changelog 头规范
// ════════════════════════════════════════════════════════════════════
console.log("\n── 数据断言汇总 ────────────────────────────────");
// 文件树可见性：API 文件列表（文件树数据源）齐齐全
const allFiles = await page.evaluate(async (pid) => {
  const res = await fetch(`/api/projects/${pid}/files`);
  return res.json();
}, projectId);
const allNames = allFiles.map((f) => f.filename);
check(
  "文件树数据源齐全：需求分析.md/原型.md/prd.md/概念版/issues 文件",
  allNames.includes("需求分析.md") &&
    allNames.includes("原型.md") &&
    allNames.includes("prd.md") &&
    allNames.some((n) => /^概念版.*\.md$/.test(n)) &&
    allNames.some((n) => /^issues\/\d{2}-.+\.md$/.test(n)),
  `(文件=${allNames.join("、")})`
);
// 文件树 DOM 抽查：重载页面让文件树重新拉取后，关键文件名可见
await page.reload();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(800);
const domNames = ["需求分析.md", "原型.md", "prd.md"];
let domVisibleCount = 0;
for (const name of domNames) {
  const visible = await page.getByText(name, { exact: true }).first().isVisible().catch(() => false);
  if (visible) domVisibleCount++;
}
check("文件树 DOM 抽查：3/3 关键文件可见", domVisibleCount === 3, `(可见 ${domVisibleCount}/3)`);
const issuesDomVisible = await page
  .getByText(/^\d{2}-.+\.md$/)
  .first()
  .isVisible()
  .catch(() => false);
check("文件树 DOM 抽查：issues/ 子目录文件可见（显示名 NN-<slug>.md）", issuesDomVisible);

// 协议标记落库：四环 messages API 返回的落库内容含对应标记（MongoDB 落库 = API 中介断言）
const markerChecks = [
  ["需求分析环", "requirement_analyst", /%%%FILE_BEGIN%%%\s*需求分析\.md/],
  ["原型环", "prototype", /%%%FILE_BEGIN%%%\s*原型\.md/],
  ["PRD 环", "mvp_prd", /%%%SCOPE_FROZEN%%%/],
  ["任务拆分环", "ticket_splitter", /%%%FILE_BEGIN%%%\s*issues\//],
];
for (const [ringName, agentType, re] of markerChecks) {
  const msgs = await page.evaluate(async ({ wid, agentType }) => {
    const tabsRes = await fetch(`/api/work-records/${wid}/tabs`);
    const tabs = await tabsRes.json();
    const tabList = Array.isArray(tabs) ? tabs : (tabs.tabs ?? []);
    const tab = tabList.find((t) => t.agent_type === agentType);
    if (!tab) return [];
    const res = await fetch(`/api/tabs/${tab.id ?? tab._id}/messages`);
    const data = await res.json();
    return (data.messages ?? []).filter((m) => m.role === "assistant").map((m) => m.content);
  }, { wid: workRecordId, agentType });
  const joined = msgs.join("\n");
  check(`${ringName}协议标记落库（${agentType}）`, re.test(joined), `(消息 ${msgs.length} 条)`);
}
// HTML 标记成对落库（BEGIN 与 END 数一致，不被截断）
const ptMsgs = await page.evaluate(async (tid) => {
  const res = await fetch(`/api/tabs/${tid}/messages`);
  const data = await res.json();
  return (data.messages ?? []).filter((m) => m.role === "assistant").map((m) => m.content);
}, ptCreated.tab?.id ?? ptCreated.tab?._id);
const htmlBegin = ptMsgs.join("\n").split("%%%HTML_BEGIN%%%").length - 1;
const htmlEnd = ptMsgs.join("\n").split("%%%HTML_END%%%").length - 1;
check("HTML 标记成对落库（BEGIN=END≥1）", htmlBegin === htmlEnd && htmlBegin >= 1, `(BEGIN=${htmlBegin} END=${htmlEnd})`);

// ════════════════════════════════════════════════════════════════════
// 对话纪律轻量检查（WARN 不 fail，四环合并统计）
// ════════════════════════════════════════════════════════════════════
console.log("\n── 对话纪律轻量检查 ────────────────────────────");
const ringTags = ["需求分析", "原型", "PRD", "任务拆分"];
const ringReplies = [
  raReplies,
  ptReplies,
  prdReplies,
  tsReplies,
].map((r, idx) => ({ tag: ringTags[idx], replies: r }));
for (const { tag, replies } of ringReplies) {
  for (const [i, content] of replies.entries()) {
    const visible = content
      .replace(/%%%FILE_BEGIN%%%[\s\S]*?%%%FILE_END%%%/g, "")
      .replace(/%%%HTML_BEGIN%%%[\s\S]*?%%%HTML_END%%%/g, "");
    const tableLines = (visible.match(/^\s*\|.+\|\s*$/gm) ?? []).length;
    if (tableLines > 5) {
      warn(`${tag} 第 ${i + 1} 条回复表格 ${tableLines} 行（5×5 边界内应为 ≤5）`);
    }
    const maxCols = Math.max(
      0,
      ...(visible.match(/^\s*\|.+\|\s*$/gm) ?? []).map((l) => (l.match(/\|/g) ?? []).length - 1)
    );
    if (maxCols > 5) {
      warn(`${tag} 第 ${i + 1} 条回复表格 ${maxCols} 列（5×5 边界内应为 ≤5）`);
    }
    const questions = (visible.match(/[？?]/g) ?? []).length;
    if (questions > 4) {
      warn(`${tag} 第 ${i + 1} 条回复问号 ${questions} 个（决策点制代理指标，明显异常）`);
    }
  }
}
if (warnCount === 0) console.log("  ✅ 对话纪律轻量检查全部通过（无 WARN）");

// ── 失败诊断：四环对话轮次摘要 ─────────────────────────
if (fail > 0 || warnCount > 0) {
  console.log("  ── 对话轮次摘要（诊断）──");
  for (const { tag, replies } of ringReplies) {
    console.log(`  [${tag}]`);
    replies.forEach((c, i) => console.log(`    [${i + 1}] ${c.slice(0, 150).replace(/\n/g, " ")}`));
  }
}

await browser.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败${warnCount ? `, ${warnCount} 条 WARN` : ""}`);
process.exit(fail > 0 ? 1 : 0);
