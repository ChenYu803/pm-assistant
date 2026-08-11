import mongoose from "mongoose";
import Message from "@/models/Message";
import WorkRecord from "@/models/WorkRecord";
import { createDeepSeekClient, DEEPSEEK_MODEL } from "@/lib/deepseek";

/**
 * Attempt to auto-generate a work record name from the conversation content.
 * Only triggers when:
 *   - The tab has ≥3 messages
 *   - The work record name is still the default "未命名"
 *
 * Returns the new name if generated, or null if conditions not met / generation fails.
 */
export async function autoNameWorkRecord(
  tabId: mongoose.Types.ObjectId,
  workRecordId: mongoose.Types.ObjectId
): Promise<string | null> {
  try {
    // Check message count
    const messageCount = await Message.countDocuments({ tab_id: tabId });
    if (messageCount < 3) return null;

    // Check if already named
    const workRecord = await WorkRecord.findById(workRecordId);
    if (!workRecord || workRecord.name !== "未命名") return null;

    // Get API key
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.warn("autoNameWorkRecord: DEEPSEEK_API_KEY not set");
      return null;
    }

    // Collect messages for context
    const messages = await Message.find({ tab_id: tabId })
      .sort({ timestamp: 1 })
      .limit(20)
      .lean();

    const conversationText = messages
      .map((m) => `${m.role === "user" ? "用户" : "AI"}: ${m.content}`)
      .join("\n");

    const openai = createDeepSeekClient();

    // 显式短超时 + 禁用重试：autoName 是锦上添花的命名功能，挂在 chat/route.ts
    // 的 done 事件之前——若 LLM 调用偶发挂起，SDK 默认 10 分钟超时 × 重试 2 次
    // = 最坏 30 分钟，期间 done 不发、前端对话框卡死（2026-08-11 实测复现：
    // 原型对话第 3 轮卡死 56 分钟）。20s 失败即 catch，主流程立即继续。
    const response = await openai.chat.completions.create(
      {
        model: DEEPSEEK_MODEL,
        max_tokens: 50,
        messages: [
          {
            role: "system",
            content:
              "你是一个对话摘要助手。根据对话内容生成一个简短的工作记录名称。直接输出名称（≤20个中文字符），不要加引号、不要解释、不要有任何前缀。名称应概括对话的核心主题。",
          },
          {
            role: "user",
            content: `基于以下对话，生成一个简短的工作记录名称（≤20字）：\n\n${conversationText}`,
          },
        ],
      },
      { timeout: 20_000, maxRetries: 0 }
    );

    let name = response.choices[0]?.message?.content?.trim() ?? "";
    // Sanitize: remove quotes, limit length
    name = name.replace(/^["'「『]|["'」』]$/g, "").slice(0, 20);

    if (!name) return null;

    workRecord.name = name;
    await workRecord.save();

    return name;
  } catch (error) {
    console.error("autoNameWorkRecord error:", error);
    return null;
  }
}
