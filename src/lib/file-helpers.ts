import type { IProjectFileDocument } from "@/models/ProjectFile";

export interface ProjectFileData {
  id: string;
  filename: string;
  content: string;
  project_id: string;
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

