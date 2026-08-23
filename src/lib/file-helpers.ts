import type { IProjectFileDocument } from "@/models/ProjectFile";

/** Agent 写入协议允许的 Agent 类型与文件名边界。 */
export const ALLOWED_AGENT_TYPES = [
  "requirement_analyst",
  "prototype",
  "mvp_prd",
  "ticket_splitter",
] as const;

export const MAX_FILE_BYTES = 3 * 1024 * 1024;

const ROOT_DELIVERABLES = new Set(["需求分析.md", "原型.md", "prd.md"]);
const WORKING_DOC_RE = /^需求分析-工作文档（[^/\\]+）\.md$/u;
const CONCEPT_DOC_RE = /^概念版（[^/\\]+）\.md$/u;
const ISSUE_RE = /^issues\/(?:v\d+\/)?\d{2}-[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9_\-\u4e00-\u9fff]*\.md$/u;

export type FileWriteValidation =
  | { ok: true; filename: string }
  | { ok: false; error: string };

/** Validate a filename against the v1.2 Agent file protocol. */
export function validateAgentFilename(
  filename: unknown,
  agentType: unknown
): FileWriteValidation {
  if (
    typeof agentType !== "string" ||
    !ALLOWED_AGENT_TYPES.some((allowedType) => allowedType === agentType)
  ) {
    return { ok: false, error: "不支持的 Agent 类型" };
  }
  if (typeof filename !== "string" || !filename.trim()) {
    return { ok: false, error: "文件名不能为空" };
  }
  if (filename !== filename.trim()) {
    return { ok: false, error: "文件名不能包含首尾空白" };
  }
  if (/[/\\]/u.test(filename) && !ISSUE_RE.test(filename)) {
    return { ok: false, error: "文件路径不符合允许的 issues 路径规则" };
  }
  if (/[\u0000-\u001f\u007f]/u.test(filename)) {
    return { ok: false, error: "文件名不能包含控制字符" };
  }
  if (filename.includes("\\") || filename.split("/").some((segment) => segment === "." || segment === ".." || !segment)) {
    return { ok: false, error: "文件路径包含非法路径段" };
  }
  if (!filename.endsWith(".md")) {
    return { ok: false, error: "只允许写入 Markdown 文件" };
  }
  if (
    !ROOT_DELIVERABLES.has(filename) &&
    !WORKING_DOC_RE.test(filename) &&
    !CONCEPT_DOC_RE.test(filename) &&
    !ISSUE_RE.test(filename)
  ) {
    return { ok: false, error: "文件名不在允许的项目文件白名单中" };
  }
  return { ok: true, filename };
}

/** Validate the UTF-8 byte size used by both Agent and user edits. */
export function validateFileSize(content: unknown): FileWriteValidation {
  if (typeof content !== "string") {
    return { ok: false, error: "文件内容不能为空" };
  }
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    return { ok: false, error: "文件内容超过 3 MiB 上限" };
  }
  return { ok: true, filename: "" };
}

export interface ProjectFileData {
  id: string;
  filename: string;
  content: string;
  project_id: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/** Serialize a ProjectFile document to a plain object for API responses. */
export function serializeProjectFile(
  file: IProjectFileDocument
): ProjectFileData {
  return {
    id: file._id.toString(),
    filename: file.filename,
    content: file.content,
    project_id: file.project_id.toString(),
    version: file.version ?? 0,
    created_at: file.created_at,
    updated_at: file.updated_at,
  };
}

// ─── Shared changelog utilities ───────────────────────────────────────────────

/** Regex matching the changelog markdown comment block at the start of a file. */
export const CHANGELOG_HEADER_RE =
  /^<!--\nchangelog:\n[\s\S]*?-->\n?/;

/** Strip the changelog header from file content for display. */
export function stripChangelogHeader(content: string): string {
  if (!content) return "";
  return content.replace(CHANGELOG_HEADER_RE, "").trimStart();
}

// ─── Working-doc (中间过程快照) 识别 ───────────────────────────────────────────
// 工作文档 = Agent 对话中维护的中间过程快照（如「需求分析-工作文档（Tab 名）.md」）：
// 文件树可见（特殊样式）、不可加载进 Agent 上下文、写入时整文件替换、无 changelog 头。
// 文件名含「工作文档」即识别，前后端共用（file tree 样式 / ChatArea 静默写入 /
// 写入 API 替换模式 / context 加载过滤）。

/** 文件名是否标识工作文档（中间过程快照，非正式交付物）。 */
export function isWorkingDocFile(filename: string): boolean {
  return filename.includes("工作文档");
}

// ─── 概念版文档 识别 ──────────────────────────────────────────────────────────
// 概念版 = PRD 流程确认产物（「概念版（标签页名）.md」），对话内确认后落盘为
// 文件树独立文件，供人侧回看（05 mini 会修订 ADR-0003「对话内完成、不落盘」）：
// 正式文件样式（📄）、写入需弹确认框（非工作文档）、但不可加载进 Agent 上下文
// （AI 侧单源不破——prd.md 概念章才是正式单源）。文件名含「概念版」即识别。

/** 文件名是否标识概念版文档（流程确认产物，人侧回看锚点，不可加载进 Agent 上下文）。 */
export function isConceptDocFile(filename: string): boolean {
  return filename.includes("概念版");
}

// ─── 子路径文件名（issues/NN-<slug>.md）识别 ─────────────────────────────────
// 任务拆分 Agent 的产物落在 issues/ 子路径下（spec: Issues 文件集）——
// 文件名含目录前缀即子路径文件，文件树以子目录分组展示。

/** 文件名是否带子路径前缀（如 issues/01-用户注册.md）。 */
export function isSubpathFile(filename: string): boolean {
  return filename.includes("/");
}

/** 文件树展示名：去掉子路径前缀，仅显示文件名段。 */
export function displayName(filename: string): string {
  return isSubpathFile(filename) ? filename.split("/").pop() || filename : filename;
}

/** 下载文件名：去掉子路径前缀——浏览器 download 属性不支持路径分隔符。 */
export function downloadFilename(filename: string): string {
  return displayName(filename);
}
