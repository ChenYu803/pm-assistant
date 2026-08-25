// 验证 03 ticket：需求分析 Agent 对话人格升级（方案 B 需求分析侧）
// - 真实对话：产出需求分析.md，四段分析齐全（用户与场景/用户故事/功能范围/成功指标）
// - 真实对话：功能范围段含排除项（「不做/排除」类表述）
// - 真实对话：Agent 维护工作文档（「需求分析-工作文档（…）.md」出现在文件树）
// - 工作文档不可加载进 Agent 上下文（POST 加载被 400 拒绝）
// - 轻量检查（WARN 不 fail）：对话回复表格 ≤5 行（5×5 边界）；每轮问号 ≤2
// 前置：dev server 运行在 localhost:3000，MySQL 测试环境可用，
//       默认 AI_MODE=replay；真实模型验证时才需要 AI_MODE=live + AI_API_KEY
// 用法: node scripts/verify-requirement-analyst-discipline.mjs
import { chromium } from "playwright-core";

if (process.env.AI_MODE !== "replay") {
  console.error("❌ 验证要求 AI_MODE=replay，未运行");
  process.exit(1);
}

const BASE = "http://localhost:3000";

const email = `verify-rd-${Date.now()}@test.local`;
const password = "verify-pass-1234";
const MAX_ROUNDS = 16; // 真实对话轮数上限（控制 token 消耗）
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
await page.fill('input[placeholder="输入项目名称"]', "验证需求分析纪律");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /验证需求分析纪律/ }).click();
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

// ── API 创建需求分析 tab，拿 tab id ─────────────────────
const created = await page.evaluate(async (wid) => {
  const res = await fetch(`/api/work-records/${wid}/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pm-assistant-test-system-write": "1" },
    body: JSON.stringify({ agent_type: "requirement_analyst" }),
  });
  const data = await res.json();
  return { status: res.status, tab: data.tab, context: (data.context_files ?? []).map((f) => f.filename) };
}, workRecordId);
check("创建需求分析 tab 成功", created.status === 201, `(status=${created.status})`);
const tabId = created.tab?.id;
check("拿到 tab id", !!tabId, `(实际=${JSON.stringify(created.tab)?.slice(0, 120)})`);

// 激活该 tab（API 创建的 tab 需先刷新页面；TabBar 的 tab 是 div 而非 button）
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByText("需求分析 #1", { exact: true }).first().click();
await page.waitForTimeout(600);

// ── 真实对话：第一轮给足素材，之后应答池推进 ─────────────
// 素材覆盖：目标用户/场景/痛点/功能想法/确定不做——让 Agent 少问多推
const OPENING =
  "我有一个产品想法，请开始需求分析。\n想法：校园二手交易平台。\n" +
  "目标用户：本校大学生。使用场景：毕业季清理闲置、日常买卖二手书和生活用品。\n" +
  "当前痛点：只能靠微信群发图卖二手，无检索、无信用体系、交易全靠私聊。\n" +
  "功能想法：商品发布、分类浏览搜索、站内私聊、用户评价。\n" +
  "确定不做：不搞物流配送、不做担保交易、不做移动 App 只做网页。\n请开始。";
// 前几轮正常应答，之后持续推进（推进话术多轮重复，确保 Agent 走向收尾）
const PUSH_POOL = [
  "我们已经讨论得比较充分了。请汇总结论：补齐四段分析（用户与场景/用户故事/功能范围/成功指标），把确定不做的列入排除清单，然后输出需求分析.md。",
  "请继续推进：把确认的结论整理成完整的需求分析文档输出。",
];

/** 引导式应答：按 Agent 本轮回复的关键词给出针对性回答（模拟配合的新手用户）。
 *  注意：Agent 回复中「提到」某个词 ≠ 「在问」——「已记录/已确认」类句式优先，
 *  且同一分支连续命中时改用推进话术，防止答非所问空转。 */
let lastReplyBranch = "";
function replyFor(lastContent) {
  const branches = [
    // Agent 声明已收到/已记录（重复回复的真实场景）——不再重复回答
    [/记录|已收到|重复|无需修改|已完整|已确认/, "recorded", "好的，这条已确认，请继续推进下一步。"],
    [/首页|形态|布局/, "home", "首页形态按你的建议来：分类导航式为主。"],
    [/卖方|买方|10个学生|画像/, "priority", "卖方优先吧，发布是核心，先解决有没有货的问题。"],
    [/频率|多久|高频|低频/, "freq", "商品发布和搜索是高频（毕业季几乎每天），私聊中频，评价中频。"],
    [/取舍|保留|排除|不做|真实/, "triage", "四条功能需求（发布/搜索/私聊/评价）都保留，按你的分析来。明确排除：物流配送、担保交易、移动 App。"],
    [/场景|目标用户|用户与场景/, "scene", "就是本校学生，毕业季清理闲置、日常买卖二手，现在靠微信群。"],
    [/功能范围|做 X|MVP|优先级/, "scope", "功能就做：商品发布、分类浏览搜索、站内私聊、用户评价，发布和搜索是 P0。"],
    [/成功指标|衡量/, "metric", "成功指标：上线 1 个月内发布商品 100 件、完成交易 30 笔。"],
    [/用户故事|作为/, "story", "是，用户故事按你复述的来。"],
    [/确认|可以吗|对吗|对吧|理解得对吗|没问题/, "confirm", "确认，没问题。"],
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
  // 回复完成后可能出现文件确认框（正式交付物仍弹框）——等待出现后点掉。
  // isVisible() 是瞬时检查，弹框渲染晚于回复完成，必须用 waitFor 等。
  try {
    const confirmBtn = page.getByRole("button", { name: "确认写入" });
    await confirmBtn.waitFor({ state: "visible", timeout: 4000 });
    await confirmBtn.click();
    console.log(`  [对话] 第 ${roundNo} 轮点击了「确认写入」`);
    await page.waitForTimeout(400);
  } catch {
    // 无确认框（本轮回复未产出文件 / 工作文档静默写入）
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
for (let i = 0; i < MAX_ROUNDS - 1; i++) {
  const last = rawReplies[rawReplies.length - 1] ?? "";
  // 已产出需求分析.md（精确匹配 marker + 文件名——工作文档 marker 也含 FILE_BEGIN）
  if (/%%%FILE_BEGIN%%%\s*需求分析\.md/.test(last)) break;
  // Agent 还在提问 → 针对性应答；Agent 在推进/待确认 → 推进话术
  const text =
    i >= 3 && !/[？?]/.test(last)
      ? PUSH_POOL[i % PUSH_POOL.length]
      : replyFor(last);
  await sendAndWait(text, i + 2);
}

// ── 文件断言 ─────────────────────────────────────────────
const files = await page.evaluate(async (pid) => {
  const res = await fetch(`/api/projects/${pid}/files`);
  return res.json();
}, projectId);

const fileByName = (name) => files.find((f) => f.filename.includes(name));
const reqDoc = fileByName("需求分析.md");
if (!reqDoc) {
  console.log("  ── 对话轮次摘要（诊断）──");
  rawReplies.forEach((c, i) =>
    console.log(`  [${i + 1}] ${c.slice(0, 120).replace(/\n/g, " ")}`)
  );
}
check("需求分析.md 已产出", !!reqDoc, `(文件列表=${files.map((f) => f.filename).join("、")})`);

if (reqDoc) {
  const reqContent = await page.evaluate(async ({ pid, fid }) => {
    const res = await fetch(`/api/projects/${pid}/files/${fid}`);
    const data = await res.json();
    return data.content ?? "";
  }, { pid: projectId, fid: reqDoc.id });

  const fourSections = ["用户与场景", "用户故事", "功能范围", "成功指标"];
  for (const s of fourSections) {
    check(`需求分析.md 含「${s}」段`, reqContent.includes(s), `(四段完整性)`);
  }
  // 排除项断言收紧：限定在「功能范围」段内（到下一个 ### 标题之间），
  // 且排除项附理由（spec: 功能范围段充实为「做 X + 不做 Y（附理由）」）
  const scopeMatch = reqContent.match(/### 功能范围\n([\s\S]*?)(?=\n### |\n# 排除清单|$)/);
  const scopeSection = scopeMatch ? scopeMatch[1] : "";
  const exclusionInScope = /不做|排除/.test(scopeSection);
  check(
    "功能范围段内含排除项（不做 Y）",
    exclusionInScope,
    `  (功能范围段应含「不做 Y」；段内容=${scopeSection.slice(0, 60)})`
  );
  // 理由形态：排除语句内带括号/破折号/因为/理由（如「不做物流（成本高）」）
  check(
    "功能范围段排除项附理由",
    /(?:不做|排除)[^。\n]*(?:因为|理由|（|—)/.test(scopeSection),
    `  (排除语句应附理由；段内容=${scopeSection.slice(0, 120)})`
  );
  // 排除清单段全局唯一（写入 API 合并追加，不应出现重复段）
  check(
    "「# 排除清单」段恰好出现一次",
    (reqContent.match(/# 排除清单/g) ?? []).length === 1,
    `  (实际出现 ${(reqContent.match(/# 排除清单/g) ?? []).length} 次!)`
  );
}

// 工作文档出现在文件树（03 新机制）
const workDoc = fileByName("工作文档");
check(
  "工作文档出现在文件树（需求分析-工作文档（…）.md）",
  !!workDoc,
  `(文件列表=${files.map((f) => f.filename).join("、")}；期望含「工作文档」)`
);

// 工作文档不可加载进 Agent 上下文
if (workDoc) {
  const loadRes = await page.evaluate(async ({ tid, fid }) => {
    const res = await fetch(`/api/tabs/${tid}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fid }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }, { tid: tabId, fid: workDoc.id });
  check(
    "工作文档不可加载进上下文（400 拒绝）",
    loadRes.status === 400,
    `(实际 status=${loadRes.status} body=${JSON.stringify(loadRes.body)?.slice(0, 80)})`
  );
}

// ── 轻量检查：对话纪律（WARN 不 fail）────────────────────
// 只统计对话流可见文本——剥离 FILE markers 块（工作文档/需求分析.md 是文件，
// 文件内的表格不属于「对话流回复」约束）。
// 表格边界 = 5×5（行数与列数分别上限 5，含表头）；问号数是「决策点制」的
// 代理指标（决策为定性判定：一个决策点 + 子澄清，语气问句不计），阈值放宽
// 到 4——超过才提示明显违反。
for (const [i, content] of rawReplies.entries()) {
  const visible = content.replace(/%%%FILE_BEGIN%%%[\s\S]*?%%%FILE_END%%%/g, "");
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

await browser.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败${warnCount ? `, ${warnCount} 条 WARN` : ""}`);
process.exit(fail > 0 ? 1 : 0);
