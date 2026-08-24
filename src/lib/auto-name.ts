import mongoose from "mongoose";
import Message from "@/models/Message";
import WorkRecord from "@/models/WorkRecord";
import { createAICompletion, isLiveAI } from "@/lib/ai";
import {
  applyMysqlAutomaticWorkRecordName,
  mysqlConversationForAutoName,
  mysqlMessageCount,
} from "@/lib/mysql-conversation";

interface AutoNameOptions {
  /** 只供本地 replay 验证模拟命名服务结果。 */
  testName?: string;
  forceFailureForTest?: boolean;
}

/** 只允许默认名称被自动命名替换，避免过期结果覆盖用户的手动改名。 */
export async function applyAutomaticWorkRecordName(
  workRecordId: mongoose.Types.ObjectId,
  name: string
): Promise<string | null> {
  const updated = await WorkRecord.findOneAndUpdate(
    { _id: workRecordId, name: "未命名" },
    { $set: { name } },
    { returnDocument: "after" }
  );
  return updated?.name ?? null;
}

/**
 * 自动根据对话生成工作记录名称；消息不足、已手动命名或生成失败时保持原名。
 */
export async function autoNameWorkRecord(
  tabId: mongoose.Types.ObjectId,
  workRecordId: mongoose.Types.ObjectId,
  options: AutoNameOptions = {}
): Promise<string | null> {
  try {
    if (options.forceFailureForTest) {
      throw new Error("自动命名测试失败");
    }

    // 对话不足时信息不够，保持默认名称。
    const messageCount = await Message.countDocuments({ tab_id: tabId });
    if (messageCount < 3) return null;

    // 用户或其他请求已命名时，自动结果不能覆盖。
    const workRecord = await WorkRecord.findById(workRecordId);
    if (!workRecord || workRecord.name !== "未命名") return null;

    if (options.testName) {
      return applyAutomaticWorkRecordName(workRecord._id, options.testName);
    }

    // 固定回放不请求真实模型，也不改变名称。
    if (!isLiveAI()) {
      return null;
    }

    // 收集近期对话作为命名上下文。
    const messages = await Message.find({ tab_id: tabId })
      .sort({ timestamp: 1 })
      .limit(20)
      .lean();

    const conversationText = messages
      .map((m) => `${m.role === "user" ? "用户" : "AI"}: ${m.content}`)
      .join("\n");

    // 20 秒超时且不重试；自动命名是辅助功能，失败时不影响聊天。
    let name = await createAICompletion({
      maxTokens: 50,
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
      timeoutMs: 20_000,
    });
    // 去掉常见引号并限制长度。
    name = name.replace(/^["'「『]|["'」』]$/g, "").slice(0, 20);

    if (!name) return null;

    return applyAutomaticWorkRecordName(workRecord._id, name);
  } catch (error) {
    console.error("autoNameWorkRecord error:", error);
    return null;
  }
}

/** MySQL 工作区沿用同一命名阈值与条件更新语义。 */
export async function autoNameMysqlWorkRecord(
  tabId: string,
  workRecordId: string,
  options: AutoNameOptions = {}
): Promise<string | null> {
  try {
    if (options.forceFailureForTest) throw new Error("自动命名测试失败");
    if ((await mysqlMessageCount(tabId)) < 3) return null;
    if (options.testName) return applyMysqlAutomaticWorkRecordName(workRecordId, options.testName);
    if (!isLiveAI()) return null;
    const messages = await mysqlConversationForAutoName(tabId);
    const conversationText = messages
      .map((message) => `${message.role === "user" ? "用户" : "AI"}: ${message.content}`)
      .join("\n");
    let name = await createAICompletion({
      maxTokens: 50,
      messages: [
        {
          role: "system",
          content: "你是一个对话摘要助手。根据对话内容生成一个简短的工作记录名称。直接输出名称（≤20个中文字符），不要加引号、不要解释、不要有任何前缀。名称应概括对话的核心主题。",
        },
        { role: "user", content: `基于以下对话，生成一个简短的工作记录名称（≤20字）：\n\n${conversationText}` },
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
