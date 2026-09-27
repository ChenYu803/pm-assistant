const ANALYSIS_FILENAME = /^需求分析-[^/\\\r\n\u0000-\u001f\u007f]{1,180}\.md$/u;

/** 候选文件名始终留在需求分析树枝；服务端写入前也会重新校验。 */
export function validAnalysisFilename(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && ANALYSIS_FILENAME.test(value)
    && !value.includes("..") && !value.includes("工作文档") && !value.includes("概念版");
}
