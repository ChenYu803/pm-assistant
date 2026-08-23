// 协议一致性安全网：断言协议标记与显式冻结入口在
// ① prompt 定义处 / ② chat route 冻结执法处 / ③ 前端 ChatArea marker 解析处
// 三处保持同步，防重构 prompt 时漏改（spec: Testing Decisions）。
// 用法: node scripts/verify-protocols.mjs
// 前置：无 —— 纯静态读文件，dev server / MongoDB 均可关闭
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── 三处参与方 ───────────────────────────────────────────────────────────────
// ① prompt 定义处：AGENT_SYSTEM_PROMPTS 模板中的协议字面量
// ② chat route 冻结执法处：freeze 布尔操作与冻结标记的判断/strip
// ③ ChatArea marker 解析处：FILE_MARKER_RE 提取与渲染期 strip
// 协议模型：每个协议项声明「期望参与方」——② 不执法文件标记、③ 不执法
// 肯定词（冻结校验只在服务端），故不参与对应比对，避免把「不参与」误报为冲突。
const SRC_PATHS = {
  prompt: "src/lib/agent-prompts.ts",
  route: "src/app/api/tabs/[id]/chat/route.ts",
  chat_area: "src/components/ChatArea.tsx",
};
const sources = {};
for (const [key, rel] of Object.entries(SRC_PATHS)) {
  sources[key] = fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const FILE_BEGIN = "%%%FILE_BEGIN%%%";
const FILE_END = "%%%FILE_END%%%";
const SCOPE_FROZEN = "%%%SCOPE_FROZEN%%%";
const SCOPE_FREEZE_PROPOSAL = "%%%SCOPE_FREEZE_PROPOSAL%%%";
const HTML_BEGIN = "%%%HTML_BEGIN%%%";
const HTML_END = "%%%HTML_END%%%";

// 注释行（代码文件的 // 或 * 行）——注释里的字面量不算数：
// 改坏代码行而注释没改时不得误判为「标记仍在」
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*");
}

// 这是清理任意协议标记的通用正则，不是一个待校验的协议字面量。
function isGenericMarkerCleanup(line) {
  const markers = line.match(/%%%[^%]*%%%/g) ?? [];
  return markers.length === 1 && markers[0] === "%%%[A-Z_]+%%%";
}

// 字面量在文件中的所有出现行号（1-based），代码文件排除注释行
function linesOf(content, literal, skipComments = false) {
  const hits = [];
  content.split("\n").forEach((line, i) => {
    if (skipComments && isCommentLine(line)) return;
    if (line.includes(literal)) hits.push(i + 1);
  });
  return hits;
}

// 协议行完整性：代码文件中任何含 %%% 的非注释行必须包含至少一个完整
// 已知标记——「改坏成新字符串」（如 %%%SCOPE_FROZE%%%）时精确报出改坏行号
function incompleteProtocolLines(content) {
  const known = [
    FILE_BEGIN,
    FILE_END,
    SCOPE_FROZEN,
    SCOPE_FREEZE_PROPOSAL,
    HTML_BEGIN,
    HTML_END,
  ];
  const out = [];
  content.split("\n").forEach((line, i) => {
    if (isCommentLine(line)) return;
    if (!line.includes("%%%")) return;
    if (isGenericMarkerCleanup(line)) return;
    if (!known.some((k) => line.includes(k))) out.push(i + 1);
  });
  return out;
}

// 参与方缺失协议标记时，列出该文件剩余的 %% 行——「改坏成新字符串」时
// 能直接指出改坏在哪一行
function leftoverMarkers(content, known) {
  return content
    .split("\n")
    .map((line, i) => ({ n: i + 1, line }))
    .filter(
      ({ line }) =>
        !isCommentLine(line) &&
        line.includes("%%%") &&
        !isGenericMarkerCleanup(line) &&
        !known.some((k) => line.includes(k))
    )
    .map(({ n, line }) => `${n}:${line.trim().slice(0, 60)}`);
}

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

// 参与方出现性检查：期望该文件出现 ≥1 次标记，缺失时用剩余 %% 行定位改坏处
function checkPresence(marker, key, label) {
  const skipComments = key !== "prompt"; // prompt 是模板文本，无注释行
  const hits = linesOf(sources[key], marker, skipComments);
  check(
    `标记 ${marker}：${label}包含`,
    hits.length >= 1,
    `(期望: 出现 ≥1 次；实际: ${hits.length} 次 ${
      hits.length
        ? `行 ${hits.join(",")}`
        : `，现存 %% 行: ${leftoverMarkers(sources[key], [marker]).join("；")}`
    })`
  );
  return hits;
}

// ── 检查 1：文件产出标记 %%%FILE_BEGIN%%% / %%%FILE_END%%% ─────────────────
// 参与方：① prompt 定义 + ③ ChatArea 解析（② 不执法文件标记）
for (const marker of [FILE_BEGIN, FILE_END]) {
  checkPresence(marker, "prompt", "① prompt 定义处");
  checkPresence(marker, "chat_area", "③ ChatArea 解析处");
}

// ① prompt 内 BEGIN/END 实例必须成对且顺序配对（46/48 与 151/153 两个文件
// 产出规范）——只改坏其中一个实例、另一个未同步时，计数或配对即失衡
const beginInPrompt = linesOf(sources.prompt, FILE_BEGIN);
const endInPrompt = linesOf(sources.prompt, FILE_END);
const promptPaired =
  beginInPrompt.length === endInPrompt.length &&
  beginInPrompt.every((b, i) => b < endInPrompt[i]);
check(
  `标记 ${FILE_BEGIN}/${FILE_END}：① prompt 内实例成对`,
  promptPaired,
  `(期望: 每个 BEGIN 对应后置的 END；实际: BEGIN ${beginInPrompt.length} 处 行 ${beginInPrompt.join(",") || "无"} / END ${endInPrompt.length} 处 行 ${endInPrompt.join(",") || "无"})`
);

// ChatArea 内 BEGIN/END 必须成对出现（63 行常量正则 + 487 行渲染期正则）——
// 只改坏其中一个定义、另一个未同步时，行号集合即失去对称
const beginInChat = linesOf(sources.chat_area, FILE_BEGIN, true);
const endInChat = linesOf(sources.chat_area, FILE_END, true);
const paired =
  beginInChat.length === endInChat.length &&
  beginInChat.every((n) => endInChat.includes(n)) &&
  endInChat.every((n) => beginInChat.includes(n));
check(
  `标记 ${FILE_BEGIN}/${FILE_END}：③ ChatArea 内成对出现`,
  paired,
  `(期望: BEGIN 与 END 出现在相同行；实际: BEGIN 行 ${beginInChat.join(",") || "无"} / END 行 ${endInChat.join(",") || "无"})`
);

// ── 检查 1b：HTML 原型快照标记 %%%HTML_BEGIN%%% / %%%HTML_END%%% ───────────
// 参与方：① prompt 定义 + ③ ChatArea 解析（② route 不执法——HTML 快照不走
// 服务端冻结逻辑，前端 Blob 下载即弃，不进文件树）
for (const marker of [HTML_BEGIN, HTML_END]) {
  checkPresence(marker, "prompt", "① prompt 定义处");
  checkPresence(marker, "chat_area", "③ ChatArea 解析处");
}

const htmlBeginInPrompt = linesOf(sources.prompt, HTML_BEGIN);
const htmlEndInPrompt = linesOf(sources.prompt, HTML_END);
const htmlPromptPaired =
  htmlBeginInPrompt.length === htmlEndInPrompt.length &&
  htmlBeginInPrompt.every((b, i) => b < htmlEndInPrompt[i]);
check(
  `标记 ${HTML_BEGIN}/${HTML_END}：① prompt 内实例成对`,
  htmlPromptPaired,
  `(期望: 每个 BEGIN 对应后置的 END；实际: BEGIN ${htmlBeginInPrompt.length} 处 行 ${htmlBeginInPrompt.join(",") || "无"} / END ${htmlEndInPrompt.length} 处 行 ${htmlEndInPrompt.join(",") || "无"})`
);

// ChatArea 内 BEGIN/END 必须成对出现（联合正则同一行定义）——只改坏其中一个
// 定义、另一个未同步时，行号集合即失去对称
const htmlBeginInChat = linesOf(sources.chat_area, HTML_BEGIN, true);
const htmlEndInChat = linesOf(sources.chat_area, HTML_END, true);
const htmlChatPaired =
  htmlBeginInChat.length === htmlEndInChat.length &&
  htmlBeginInChat.every((n) => htmlEndInChat.includes(n)) &&
  htmlEndInChat.every((n) => htmlBeginInChat.includes(n));
check(
  `标记 ${HTML_BEGIN}/${HTML_END}：③ ChatArea 内成对出现`,
  htmlChatPaired,
  `(期望: BEGIN 与 END 出现在相同行；实际: BEGIN 行 ${htmlBeginInChat.join(",") || "无"} / END 行 ${htmlEndInChat.join(",") || "无"})`
);

// ── 检查 2：范围冻结标记 %%%SCOPE_FROZEN%%% ───────────────────────────────
// 该标记不再触发冻结；prompt 只声明禁止输出，route 与 ChatArea 继续剥离旧消息
// 中的遗留标记，避免它泄露到用户界面。
checkPresence(SCOPE_FROZEN, "prompt", "① prompt 定义处");
checkPresence(SCOPE_FROZEN, "route", "② chat route 冻结执法处");
checkPresence(SCOPE_FROZEN, "chat_area", "③ ChatArea 解析处");

// 新协议：Agent proposal 仅显示控件；route 只能接受 freeze: true 的显式操作。
checkPresence(SCOPE_FREEZE_PROPOSAL, "prompt", "① prompt 冻结提议处");
check(
  "显式冻结：② chat route 使用 proposal 标记",
  sources.route.includes("SCOPE_FREEZE_PROPOSAL_MARKER"),
  "(期望: route 只将 proposal marker 处理为提议；实际: 未找到)"
);
check(
  "显式冻结：③ ChatArea 使用共享 proposal 标记",
  sources.chat_area.includes("SCOPE_FREEZE_PROPOSAL_MARKER"),
  "(期望: ChatArea 导入并使用共享 marker；实际: 未找到)"
);
check(
  "显式冻结：② chat route 只接受 freeze 布尔操作",
  sources.route.includes("const isFreeze = freeze === true"),
  "(期望: freeze === true；实际: 未找到)"
);

// 协议行完整性：②③ 代码文件中任何含 %%% 的非注释行必须含完整已知标记。
// 覆盖「改坏成新字符串」——如上各参与方按「≥1 次」检查会漏检的场景
// （如 ② 149 行判断改坏、161 行 strip 未改）
for (const key of ["route", "chat_area"]) {
  const bad = incompleteProtocolLines(sources[key]);
  check(
    `${SRC_PATHS[key]} 协议行完整性`,
    bad.length === 0,
    `(期望: 所有含 %%% 的代码行含完整标记；实际: 行 ${bad.join(",") || "无"} 缺失)`
  );
}

// ── 检查 3：自然语言不再冻结 ────────────────────────────────────────────────
check(
  "自然语言冻结：② 已移除 SCOPE_FREEZE_CONFIRM_RE",
  !sources.route.includes("SCOPE_FREEZE_CONFIRM_RE"),
  "(期望: 不再存在自然语言冻结正则；实际: 仍找到旧协议)"
);

// ── 汇总 ────────────────────────────────────────────────────────────────────
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail === 0) console.log("✅ 三处协议同步，无冲突");
process.exit(fail > 0 ? 1 : 0);
