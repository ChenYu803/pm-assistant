const ANALYSIS_FILENAME = /^需求分析-[^/\\\r\n\u0000-\u001f\u007f]{1,180}\.md$/u;
const PROTOTYPE_FILENAME = /^原型-[^/\\\r\n\u0000-\u001f\u007f]{1,180}\.md$/u;
const PRD_FILENAME = /^PRD-[^/\\\r\n\u0000-\u001f\u007f]{1,180}\.md$/u;

export type MarkdownCandidateStage = "analysis" | "prototype" | "prd";

/** 普通 Markdown 候选只能写入产生它的阶段树枝。 */
export function validCandidateFilename(value: unknown, stage: MarkdownCandidateStage): value is string {
  return typeof value === "string" && value === value.trim()
    && (stage === "analysis" ? ANALYSIS_FILENAME : stage === "prototype" ? PROTOTYPE_FILENAME : PRD_FILENAME).test(value)
    && !value.includes("..") && !value.includes("工作文档") && !value.includes("概念版");
}
