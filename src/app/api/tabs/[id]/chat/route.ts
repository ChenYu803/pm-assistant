import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Message from "@/models/Message";
import { findOwnedTabWithProject, parseObjectId } from "@/lib/ownership";
import { AGENT_SYSTEM_PROMPTS } from "@/lib/agent-prompts";
import type { AgentType } from "@/lib/agent-constants";
import { autoNameWorkRecord } from "@/lib/auto-name";
import { stripChangelogHeader } from "@/lib/file-helpers";
import { getLoadedContextFiles } from "@/lib/context-files";
import { createAIStream, isAIConfigured } from "@/lib/ai";
import type { AIMessage } from "@/lib/ai";
import {
  registerGeneration,
  releaseGeneration,
} from "@/lib/generation-control";

class GenerationInterruptedError extends Error {
  constructor() {
    super("生成已停止");
    this.name = "GenerationInterruptedError";
  }
}

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
    const { content, regenerate, messageId } = body;
    const isRegenerate = regenerate === true;

    if (
      (!isRegenerate &&
        (!content || typeof content !== "string" || !content.trim())) ||
      (isRegenerate &&
        (typeof messageId !== "string" || !parseObjectId(messageId)))
    ) {
      return NextResponse.json(
        { error: isRegenerate ? "待重新输出的消息不存在" : "消息内容不能为空" },
        { status: 400 }
      );
    }

    if (!isAIConfigured()) {
      return NextResponse.json(
        { error: "AI 服务未配置，请联系管理员设置 AI_API_KEY" },
        { status: 500 }
      );
    }

    await dbConnect();

    const ownedTab = await findOwnedTabWithProject(tabId, userId);
    if (!ownedTab) {
      return NextResponse.json(
        { error: "标签页不存在或无权操作" },
        { status: 404 }
      );
    }
    const { tab, project } = ownedTab;

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
    const contextFiles = await getLoadedContextFiles(tab._id, project._id);

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
    let historyMessages = await Message.find({ tab_id: tab._id })
      .sort({ timestamp: 1, _id: 1 })
      .lean();

    if (isRegenerate) {
      const targetId = parseObjectId(messageId);
      const lastHistoryMessage = historyMessages[historyMessages.length - 1];
      if (
        !targetId ||
        !lastHistoryMessage ||
        lastHistoryMessage.role !== "assistant" ||
        lastHistoryMessage._id.toString() !== targetId.toString()
      ) {
        return NextResponse.json(
          { error: "只能重新输出最后一条 AI 回复" },
          { status: 409 }
        );
      }

      const removed = await Message.findOneAndDelete({
        _id: targetId,
        tab_id: tab._id,
        role: "assistant",
      });
      if (!removed) {
        return NextResponse.json(
          { error: "待重新输出的消息不存在" },
          { status: 409 }
        );
      }
      historyMessages = historyMessages.slice(0, -1);
    }

    // Save user message. Retrying a failed request re-sends the same content —
    // if the trailing history message is an identical user message (the failed
    // attempt), skip saving so retry doesn't duplicate it.
    const lastHistoryMessage = historyMessages[historyMessages.length - 1];
    const isRetryDup =
      !isRegenerate &&
      lastHistoryMessage?.role === "user" &&
      lastHistoryMessage.content === content.trim();
    let userMessageId: string | undefined;
    if (!isRegenerate && !isRetryDup) {
      const savedUserMessage = await Message.create({
        role: "user",
        content: content.trim(),
        tab_id: tab._id,
        timestamp: new Date(),
      });
      userMessageId = savedUserMessage._id.toString();
    } else if (!isRegenerate && lastHistoryMessage?.role === "user") {
      userMessageId = lastHistoryMessage._id.toString();
    }

    // Build messages: system prompt + history + new user message
    const messages: AIMessage[] = [
      { role: "system", content: systemPrompt },
      ...historyMessages.map(
        (m) =>
          ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }) as AIMessage
      ),
      ...(isRegenerate
        ? []
        : [{ role: "user" as const, content: content.trim() }]),
    ];

    // 响应开始前即创建正式 assistant 消息；SSE 与后续恢复只引用该 ID。
    const assistantMessage = await Message.create({
      role: "assistant",
      content: "",
      tab_id: tab._id,
      timestamp: new Date(),
      status: "generating",
    });
    const assistantMessageId = assistantMessage._id.toString();

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        let fullContent = "";
        const generationController = registerGeneration(assistantMessageId);
        const abortFromRequest = () => generationController.abort();
        request.signal.addEventListener("abort", abortFromRequest, { once: true });

        controller.enqueue(
          sseEvent("start", {
            messageId: assistantMessageId,
            status: "generating",
            timestamp: assistantMessage.timestamp.toISOString(),
            ...(userMessageId ? { userMessageId } : {}),
          })
        );

        try {
          // 上游流式请求显式超时：停滞转有界错误——错误 SSE 恢复输入框，
          // 调用方可继续重试。600s 与 SDK 默认一致：旧 180s 按 8K 输出上限
          // 设计，32K 上限下慢速轮次（HTML 快照 8-16K tokens @ 20-30 tps）
          // 需 530-800s，180s 会把正常长输出误杀（verify-v1-flow 等待 720s）。
          // timeout 必须作为第二参 RequestOptions 传——放 body 里 SDK 不读，
          // 运行时实际走 SDK 默认 10 分钟（2026-08-11 排查 tsc 类型错时发现）。
          const aiStream = await createAIStream({
            agentType: tab.agent_type,
            maxTokens: 32768,
            messages,
            timeoutMs: 600_000,
            signal: generationController.signal,
            // 仅开发回放验证使用，确保停止生成走真实 abort 与 partial 持久化路径。
            replayDelayMs:
              process.env.NODE_ENV !== "production" &&
              request.headers.get("x-pm-verify-stream-delay") === "1"
                ? 300
                : undefined,
          });

          for await (const chunk of aiStream) {
            if (generationController.signal.aborted) {
              throw new GenerationInterruptedError();
            }
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              // 条件更新让其他进程发出的停止请求在下一个 token 发给客户端前生效。
              const updated = await Message.updateOne(
                {
                  _id: assistantMessage._id,
                  tab_id: tab._id,
                  status: "generating",
                },
                { $set: { content: fullContent } }
              );
              if (updated.matchedCount !== 1) {
                throw new GenerationInterruptedError();
              }
              controller.enqueue(
                sseEvent("token", { messageId: assistantMessageId, content: delta })
              );
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
            const userConfirmed =
              typeof content === "string" && SCOPE_FREEZE_CONFIRM_RE.test(content);
            if (userConfirmed) {
              tab.scope_frozen = true;
              await tab.save();
            } else {
              // Agent emitted the marker without user confirmation — strip it
              // so it doesn't leak into chat history or the PRD file.
              fullContent = fullContent.replace(/%%%SCOPE_FROZEN%%%/g, "");
            }
          }

          const savedMessage = await Message.findOneAndUpdate(
            {
              _id: assistantMessage._id,
              tab_id: tab._id,
              status: "generating",
            },
            {
              $set: {
                content: fullContent,
                status: "completed",
                error_message: undefined,
              },
            },
            { new: true }
          ).lean();
          if (!savedMessage) {
            throw new GenerationInterruptedError();
          }

          // Auto-name is a live-mode convenience call; replay mode skips it.
          let newName: string | null = null;
          try {
            newName = await autoNameWorkRecord(tab._id, tab.work_record_id);
          } catch (err) {
            console.error("autoNameWorkRecord failed:", err);
          }

          controller.enqueue(
            sseEvent("done", {
              messageId: assistantMessageId,
              content: savedMessage.content,
              status: savedMessage.status,
              timestamp: savedMessage.timestamp.toISOString(),
              ...(userMessageId ? { userMessageId } : {}),
              ...(newName ? { newName } : {}),
            })
          );
        } catch (err) {
          const interrupted =
            err instanceof GenerationInterruptedError ||
            generationController.signal.aborted;
          if (!interrupted) console.error("Stream error:", err);
          const message =
            (await Message.findOneAndUpdate(
              {
                _id: assistantMessage._id,
                tab_id: tab._id,
                status: "generating",
              },
              {
                $set: {
                  content: fullContent,
                  status: interrupted ? "interrupted" : "failed",
                  error_message: interrupted
                    ? "生成已停止"
                    : err instanceof Error
                      ? err.message
                      : "AI 请求失败，请稍后重试",
                },
              },
              { new: true }
            ).lean()) ??
            (await Message.findById(assistantMessage._id).lean());
          controller.enqueue(
            sseEvent("error", {
              message:
                interrupted
                  ? "生成已停止"
                  : err instanceof Error
                    ? err.message
                    : "AI 请求失败，请稍后重试",
              interrupted,
              messageId: assistantMessageId,
              content: message?.content ?? fullContent,
              status: message?.status ?? (interrupted ? "interrupted" : "failed"),
              timestamp: message?.timestamp?.toISOString() ?? assistantMessage.timestamp.toISOString(),
              ...(message?.error_message ? { errorMessage: message.error_message } : {}),
              ...(userMessageId ? { userMessageId } : {}),
            })
          );
        } finally {
          request.signal.removeEventListener("abort", abortFromRequest);
          releaseGeneration(assistantMessageId, generationController);
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
