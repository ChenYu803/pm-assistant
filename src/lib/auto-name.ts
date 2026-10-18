import { createAICompletion, isLiveAI } from "@/lib/ai";
import {
  applyMysqlAutomaticWorkRecordName,
  mysqlConversationForAutoName,
  mysqlMessageCount,
} from "@/lib/mysql-conversation";

interface AutoNameOptions {
  userId?: string;
  testName?: string;
  forceFailureForTest?: boolean;
}

/** 自动命名只条件更新默认名，迟到结果绝不覆盖手动命名。 */
export async function autoNameMysqlWorkRecord(
  tabId: string,
  workRecordId: string,
  options: AutoNameOptions = {},
): Promise<string | null> {
  try {
    if (options.forceFailureForTest) throw new Error("自动命名测试失败");
    if ((await mysqlMessageCount(tabId)) < 3) return null;
    if (options.testName)
      return applyMysqlAutomaticWorkRecordName(workRecordId, options.testName);
    if (!isLiveAI()) return null;
    const conversation = (await mysqlConversationForAutoName(tabId))
      .map(
        (message) =>
          `${message.role === "user" ? "用户" : "AI"}: ${message.content}`,
      )
      .join("\n");
    let name = await createAICompletion({
      userId: options.userId,
      maxTokens: 50,
      messages: [
        {
          role: "system",
          content:
            "你是一个对话摘要助手。根据对话内容生成一个简短的工作记录名称。直接输出名称（≤20个中文字符），不要加引号、不要解释、不要有任何前缀。名称应概括对话的核心主题。",
        },
        {
          role: "user",
          content: `基于以下对话，生成一个简短的工作记录名称（≤20字）：\n\n${conversation}`,
        },
      ],
      timeoutMs: 20_000,
    });
    name = name.replace(/^["'「『]|["'」』]$/g, "").slice(0, 20);
    return name ? applyMysqlAutomaticWorkRecordName(workRecordId, name) : null;
  } catch (error) {
    console.error("autoNameMysqlWorkRecord error:", error);
    return null;
  }
}
