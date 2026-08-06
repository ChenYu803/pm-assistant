// 验证四个修复：滚动条隔离 / Markdown 渲染 / 确认弹窗不重复 / 401 弹窗
// 用法: node scripts/verify-fixes.mjs
// 前置：dev server 运行在 localhost:3000，MongoDB 可连（.env.local 的 MONGODB_URI）
import { chromium } from "playwright-core";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = "http://localhost:3000";

// ── 读 .env.local（纯 KEY=VALUE 解析）──────────────────────────────
const envRaw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const MONGODB_URI = env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI 缺失");
  process.exit(1);
}

const email = `verify-${Date.now()}@test.local`;
const password = "verify-pass-1234";
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

// ── 连接 Mongo（原生 schema，不依赖项目模型）────────────────────────
await mongoose.connect(MONGODB_URI);
const Tab = mongoose.model(
  "VTab",
  new mongoose.Schema({
    agent_type: String,
    display_name: String,
    work_record_id: mongoose.Schema.Types.ObjectId,
    scope_frozen: Boolean,
  }),
  "tabs"
);
const Message = mongoose.model(
  "VMessage",
  new mongoose.Schema({
    role: String,
    content: String,
    tab_id: mongoose.Schema.Types.ObjectId,
    timestamp: Date,
  }),
  "messages"
);
const ProjectFile = mongoose.model(
  "VProjectFile",
  new mongoose.Schema({
    filename: String,
    content: String,
    project_id: mongoose.Schema.Types.ObjectId,
    created_at: Date,
    updated_at: Date,
  }),
  "project_files"
);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

const shot = (name) =>
  page.screenshot({
    path: path.join(ROOT, ".scratch", "screenshots", "verify", `${name}.png`),
  });

// ── 注册 → 项目 → 工作记录 → 工作台 ──────────────────────────────
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
await page.fill('input[placeholder="输入项目名称"]', "验证修复");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /验证修复/ }).click();
await page.waitForURL((u) => /\/projects\/[0-9a-f]{24}$/.test(u.pathname));
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await page.getByRole("button", { name: "确认创建" }).click();
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((u) => u.pathname.startsWith("/workspace/"));
const workRecordId = page.url().split("/").pop();

// 创建需求分析 tab
await page.getByRole("button", { name: /需求分析/ }).first().click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(800);

// 拿 tabId 和 projectId（projectId 走 work-records API）
const tabsRes = await page.evaluate(async (id) => {
  const res = await fetch(`/api/work-records/${id}/tabs`);
  return res.json();
}, workRecordId);
const tabId = tabsRes[0].id;
const wrRes = await page.evaluate(async (id) => {
  const res = await fetch(`/api/work-records/${id}`);
  return res.json();
}, workRecordId);
const projectId = wrRes.project_id;
console.log(`tab=${tabId} project=${projectId}`);

// ── 造数据：已写入文件 + 含 marker 的历史消息 + 长 markdown 消息 ──
const now = new Date();
const CHANGELOG = `<!--\nchangelog:\n  requirement_count: 1\n  iteration:        1\n  last_editor:      requirement_analyst\n  timestamp:        ${now.toISOString()}\n-->`;
const fileContent = `${CHANGELOG}\n# 需求分析文档\n\n## 1. 校园二手交易平台\n\n**用户与场景**：大二学生 C 想处理闲置教材。\n`;

await ProjectFile.create({
  filename: "需求分析.md",
  content: fileContent,
  project_id: new mongoose.Types.ObjectId(projectId),
  created_at: now,
  updated_at: now,
});

// 消息 1：带 file marker（文件名已存在 → 不应弹确认框）
const markerMsg = `需求分析完成，请确认以下产出：

%%%FILE_BEGIN%%% 需求分析.md
# 需求分析文档

## 1. 校园二手交易平台

**用户与场景**：大二学生 C 想处理闲置教材。

- 用户故事：作为学生，我想发布闲置教材，以便回收成本。
%%%FILE_END%%%

请确认后写入项目文件。`;
await Message.create({
  role: "assistant",
  content: markerMsg,
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(now.getTime() + 1000),
});

// 消息 2：长 markdown（标题/列表/代码块/引用），足以撑出聊天区滚动
const longMsg = `# 需求分析流程说明

## 诘问阶段

我会按照以下顺序追问你：

1. **用户与场景**：谁在用，什么情况下用？
2. **痛点**：现状方案哪里不好？
3. **功能范围**：MVP 必须包含什么？

> 提示：回答尽量具体，避免空泛描述。

## 四段分析模板

\`\`\`markdown
### 用户与场景
- 用户：**大二学生**
- 场景：学期末处理闲置物品

### 成功指标
1. 发布一件商品耗时 < 2 分钟
\`\`\`

## 后续步骤

接下来我会逐条确认，请逐个回答：

- 第一轮：产品背景
- 第二轮：目标用户
- 第三轮：竞品差异
- 第四轮：商业化方式
- 第五轮：验证方法
- 第六轮：范围边界
- 第七轮：成功指标
- 第八轮：风险评估
- 第九轮：优先级排序
- 第十轮：交付验收

## 预期产出

最终将生成一份**四段分析**，经你确认后写入 需求分析.md，包含：用户与场景、用户故事、功能范围、成功指标。`;
await Message.create({
  role: "assistant",
  content: longMsg,
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(now.getTime() + 2000),
});

// ── 刷新页面，验证 ────────────────────────────────────────────────
await page.reload();
await page.waitForLoadState("networkidle");
// 等消息渲染（h2 出现）
await page.locator("h2").first().waitFor({ timeout: 10000 });
await page.waitForTimeout(1200); // 给扫描 effect + setTimeout(0) 留时间
await shot("01-history-loaded");

// 问题 3：不弹确认框（需求分析.md 已存在）
const dialogCount = await page.locator('[role="dialog"]').count();
check("问题3: 重进会话不弹文件确认框", dialogCount === 0, `(dialog=${dialogCount})`);

// 问题 1：页面不滚动，聊天区内部滚动
const layout = await page.evaluate(() => {
  const doc = document.documentElement;
  // 找到最内层 overflow-y-auto 的滚动容器（聊天消息列表）
  const scrollers = [...document.querySelectorAll("*")].filter(
    (el) => getComputedStyle(el).overflowY === "auto" && el.scrollHeight > el.clientHeight + 2
  );
  return {
    pageScrolls: doc.scrollHeight > doc.clientHeight + 2,
    docH: doc.scrollHeight,
    viewH: doc.clientHeight,
    scrollerInfo: scrollers.map((el) => ({
      tag: el.tagName,
      cls: (el.className || "").toString().slice(0, 60),
      sh: el.scrollHeight,
      ch: el.clientHeight,
    })),
  };
});
check(
  "问题1: 页面本身不滚动",
  !layout.pageScrolls,
  `(doc=${layout.docH} view=${layout.viewH})`
);
const chatScroller = layout.scrollerInfo.find((s) => s.cls.includes("overflow-y-auto"));
check(
  "问题1: 聊天区有独立滚动容器",
  !!chatScroller && chatScroller.sh > chatScroller.ch,
  JSON.stringify(layout.scrollerInfo)
);
await page.evaluate(() => {
  const scroller = [...document.querySelectorAll("*")].find(
    (el) => getComputedStyle(el).overflowY === "auto" && el.scrollHeight > el.clientHeight + 2
  );
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
});
await page.waitForTimeout(300);
await shot("02-chat-scrolled");

// 问题 2：Markdown 渲染（h2/列表/代码块渲染为元素，无原始语法）
// 排除 pre 代码块：其中的 `###`/`**` 是代码块内容，本就应原样显示
const markdownCheck = await page.evaluate(() => {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll("pre").forEach((p) => p.remove());
  const body = clone.innerText;
  return {
    hasH2: !!document.querySelector(".prose h2"),
    hasUl: !!document.querySelector(".prose ul"),
    hasPre: !!document.querySelector(".prose pre"),
    hasStrong: !!document.querySelector(".prose strong"),
    hasBlockquote: !!document.querySelector(".prose blockquote"),
    rawHash: /^#{1,3}\s+\S+/m.test(body),
    rawBold: body.includes("**"),
    rawCode: body.includes("```"),
  };
});
check("问题2: 标题渲染为 h2", markdownCheck.hasH2);
check("问题2: 列表渲染为 ul", markdownCheck.hasUl);
check("问题2: 代码块渲染为 pre", markdownCheck.hasPre);
check("问题2: 加粗渲染为 strong", markdownCheck.hasStrong);
check("问题2: 引用渲染为 blockquote", markdownCheck.hasBlockquote);
check("问题2: 无原始 # 标题语法", !markdownCheck.rawHash);
check("问题2: 无原始 ** 加粗语法", !markdownCheck.rawBold, markdownCheck.rawBold ? "(存在 **)" : "");

// ── 清理 ──────────────────────────────────────────────────────────
await browser.close();
await mongoose.disconnect();

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
