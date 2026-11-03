import { createHash } from "node:crypto";
import { CreditError, creditText, creditUnits } from "@/lib/credit-values";
import type { AIMessage } from "@/lib/ai";

export type ConversationBudget = { reserved: string; inputTokenBound: number; maxOutputTokens: number; inputDigest: string; method: string; price: { inputPerMillion: string; outputPerMillion: string } };
/** V4 byte-level BPE 的文本 token 数不超过 UTF-8 字节数；聊天包装另留保守余量。
 * 这不是精确 token 计量，供应商隐含包装未有正式上界承诺，见调用契约的限制。
 */
export function conversationBudget(messages: AIMessage[], maxOutputTokens: number): ConversationBudget {
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0 || maxOutputTokens > 32768) throw new CreditError("本次输出预算不受支持，请联系管理员。", 503);
  if (!messages.length || messages.some(message => !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string" || Object.keys(message).some(key => !["role", "content"].includes(key)))) throw new CreditError("此模型输入暂不能建立费用边界，请联系管理员。", 503);
  const serialized = JSON.stringify(messages);
  const inputTokenBound = Buffer.byteLength(serialized, "utf8") + messages.length * 256 + 4096;
  // 不依靠缓存优惠，不靠缩短用户正文节省预留。两时段一律用已核实峰时价格。
  const numerator = BigInt(inputTokenBound) * creditUnits("2") + BigInt(maxOutputTokens) * creditUnits("8");
  const reserved = creditText((numerator * BigInt(2000) + BigInt(999999)) / BigInt(1000000));
  return { reserved, inputTokenBound, maxOutputTokens, inputDigest: createHash("sha256").update(serialized).digest("hex"), method: "v4-utf8-bpe-chat-envelope-v1", price: { inputPerMillion: "2", outputPerMillion: "8" } };
}
