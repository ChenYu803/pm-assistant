import Anthropic from "@anthropic-ai/sdk";
import mongoose from "mongoose";
import Message from "@/models/Message";
import WorkRecord from "@/models/WorkRecord";

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
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn("autoNameWorkRecord: ANTHROPIC_API_KEY not set");
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

    const anthropic = new Anthropic({ apiKey });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 50,
      system:
        "你是一个对话摘要助手。根据对话内容生成一个简短的工作记录名称。直接输出名称（≤20个中文字符），不要加引号、不要解释、不要有任何前缀。名称应概括对话的核心主题。",
      messages: [
        {
          role: "user",
          content: `基于以下对话，生成一个简短的工作记录名称（≤20字）：\n\n${conversationText}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;

    let name = textBlock.text.trim();
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
