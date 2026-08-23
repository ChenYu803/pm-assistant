import { createHash } from "node:crypto";

/** 冻结文档以正文摘要绑定，避免同名旧文件被当成本轮确认结果。 */
export function freezeDocumentDigest(content: string): string {
  return createHash("sha256").update(content.trim(), "utf8").digest("hex");
}
