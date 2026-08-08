import { NextResponse } from "next/server";
import type OpenAI from "openai";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Tab from "@/models/Tab";
import Message from "@/models/Message";
import { findOwnedTab } from "@/lib/ownership";
import { AGENT_SYSTEM_PROMPTS } from "@/lib/agent-prompts";
import type { AgentType } from "@/lib/agent-constants";
import { autoNameWorkRecord } from "@/lib/auto-name";
import { stripChangelogHeader } from "@/lib/file-helpers";
import { getLoadedContextFiles } from "@/lib/context-files";
import { createDeepSeekClient, DEEPSEEK_MODEL } from "@/lib/deepseek";

const encoder = new TextEncoder();

function sseEvent(type: string, data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

/** Affirmative replies that count as a user's scope-freeze confirmation. */
const SCOPE_FREEZE_CONFIRM_RE =
  /确认|可以|没问题|同意|好的|好|行|OK|ok|Yes|yes|是|完满/;

/** 各冻结 Agent 的「范围已冻结」系统提醒文案（注入 system prompt）。
 *  **键存在即成员**——同时承担「哪些 Agent 类型走冻结协议」的成员判定
 *  （spec: SCOPE_FROZEN 语义泛化为该 tab 的流程冻结标记；覆盖 mvp_prd
 *  的 PRD 范围冻结与 prototype 的原型「完满」冻结）。键拼错 = 编译错。 */
const FROZEN_REMINDERS: Partial<Record<AgentType, string>> = {
  mvp_prd:
    "当前 PRD 范围已冻结。如果用户提出新的功能需求，请礼貌地提醒用户范围已冻结，并建议将新需求放入后续迭代。不要修改已冻结的 PRD 范围。",
  prototype:
    "当前原型方案已冻结（用户已确认「完满」）。如果用户提出新的修改意见，请礼貌地提醒用户原型已冻结，并建议将修改放入下一轮迭代。不要修改已冻结的原型。",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: tabId } = await params;

    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json(
        { error: "消息内容不能为空" },
        { status: 400 }
      );
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "AI 服务未配置，请联系管理员设置 DEEPSEEK_API_KEY" },
        { status: 500 }
      );
    }

    await dbConnect();

    const tab = await findOwnedTab(tabId, userId);
    if (!tab) {
      return NextResponse.json(
        { error: "标签页不存在或无权操作" },
        { status: 404 }
      );
    }

    let systemPrompt = AGENT_SYSTEM_PROMPTS[tab.agent_type];

    // Inject tab identity for agents that need their own tab name: 需求分析
    // Agent names its working-doc file (需求分析-工作文档（{tab name}）.md);
    // PRD Agent names its concept-doc file (概念版（{tab name}）.md, 05 mini 会
    // 决策「概念版（Tab N）.md」落盘——display_name 即 Tab N). Other agents
    // have no per-tab placeholders; keep the injection surface minimal.
    if (
      tab.agent_type === "requirement_analyst" ||
      tab.agent_type === "mvp_prd"
    ) {
      systemPrompt += `\n\n## 当前标签页\n\n当前标签页名称：${tab.display_name}。`;
    }

    // Inject loaded file context into system prompt
    const contextFiles = await getLoadedContextFiles(tab._id);

    if (contextFiles.length > 0) {
      const fileBlocks = contextFiles.map((file) => {
        const body = stripChangelogHeader(file.content);
        return `### ${file.filename}\n\`\`\`markdown\n${body}\n\`\`\``;
      });
      systemPrompt +=
        "\n\n## 已加载的项目文件\n\n以下文件已加载到你的上下文中，请基于这些文件的内容进行工作：\n\n" +
        fileBlocks.join("\n\n");
    }

    // Scope-freeze gate for agents with freeze protocol (MVP-PRD / prototype)
    const frozenReminder = tab.scope_frozen ? FROZEN_REMINDERS[tab.agent_type] : undefined;
    if (frozenReminder) {
      systemPrompt += `\n\n## 范围冻结提醒\n\n${frozenReminder}`;
    }

    // Fetch history
    const historyMessages = await Message.find({ tab_id: tab._id })
      .sort({ timestamp: 1 })
      .lean();

    // Save user message. Retrying a failed request re-sends the same content —
    // if the trailing history message is an identical user message (the failed
    // attempt), skip saving so retry doesn't duplicate it.
    const lastHistoryMessage = historyMessages[historyMessages.length - 1];
    const isRetryDup =
      lastHistoryMessage?.role === "user" &&
      lastHistoryMessage.content === content.trim();
    if (!isRetryDup) {
      await Message.create({
        role: "user",
        content: content.trim(),
        tab_id: tab._id,
        timestamp: new Date(),
      });
    }

    // Build messages: system prompt + history + new user message
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...historyMessages.map(
        (m) =>
          ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }) as OpenAI.Chat.Completions.ChatCompletionMessageParam
      ),
      { role: "user", content: content.trim() },
    ];

    const openai = createDeepSeekClient();

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        let fullContent = "";

        try {
          const deepseekStream = await openai.chat.completions.create({
            model: DEEPSEEK_MODEL,
            max_tokens: 8192,
            messages,
            stream: true,
          });

          for await (const chunk of deepseekStream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              controller.enqueue(sseEvent("token", { content: delta }));
            }
          }

          // Scope-freeze gate: the marker only counts if the user actually
          // confirmed — the message immediately before this response is the
          // current user message (content). historyMessages was fetched before
          // the current user message was saved, so its last entry is the
          // *previous* message, not the confirmation (spec US24: 手动确认后
          // 才继续落地版)。
          if (
            FROZEN_REMINDERS[tab.agent_type] !== undefined &&
            !tab.scope_frozen &&
            fullContent.includes("%%%SCOPE_FROZEN%%%")
          ) {
            const userConfirmed = SCOPE_FREEZE_CONFIRM_RE.test(content);
            if (userConfirmed) {
              tab.scope_frozen = true;
              await tab.save();
            } else {
              // Agent emitted the marker without user confirmation — strip it
              // so it doesn't leak into chat history or the PRD file.
              fullContent = fullContent.replace(/%%%SCOPE_FROZEN%%%/g, "");
            }
          }

          // Save assistant message
          const savedMessage = await Message.create({
            role: "assistant",
            content: fullContent,
            tab_id: tab._id,
            timestamp: new Date(),
          });

          // Auto-name: uses deepseek-chat (same model), latency is minimal
          let newName: string | null = null;
          try {
            newName = await autoNameWorkRecord(tab._id, tab.work_record_id);
          } catch (err) {
            console.error("autoNameWorkRecord failed:", err);
          }

          controller.enqueue(
            sseEvent("done", {
              messageId: savedMessage._id.toString(),
              ...(newName ? { newName } : {}),
            })
          );
        } catch (err) {
          console.error("Stream error:", err);
          // Persist partial content if any tokens were received — the user's
          // work is kept (spec US38). With no tokens, the user message stays
          // as-is; no raw error text is ever written to history.
          let partialMessageId: string | undefined;
          if (fullContent) {
            try {
              const savedPartial = await Message.create({
                role: "assistant",
                content: fullContent + "\n\n[回复因错误中断]",
                tab_id: tab._id,
                timestamp: new Date(),
              });
              partialMessageId = savedPartial._id.toString();
            } catch {
              // Best effort
            }
          }
          controller.enqueue(
            sseEvent("error", {
              message:
                err instanceof Error ? err.message : "AI 请求失败，请稍后重试",
              ...(partialMessageId ? { messageId: partialMessageId } : {}),
            })
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("POST /api/tabs/[id]/chat error:", error);
    return NextResponse.json(
      { error: "发送消息失败" },
      { status: 500 }
    );
  }
}
