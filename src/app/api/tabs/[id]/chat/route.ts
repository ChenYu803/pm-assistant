import { NextResponse } from "next/server";
import OpenAI from "openai";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Tab from "@/models/Tab";
import Message from "@/models/Message";
import { findOwnedTab } from "@/lib/ownership";
import { AGENT_SYSTEM_PROMPTS } from "@/lib/agent-prompts";
import { autoNameWorkRecord } from "@/lib/auto-name";

const encoder = new TextEncoder();

function sseEvent(type: string, data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

const MODEL = "deepseek-chat";

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

    const systemPrompt = AGENT_SYSTEM_PROMPTS[tab.agent_type];

    // Fetch history
    const historyMessages = await Message.find({ tab_id: tab._id })
      .sort({ timestamp: 1 })
      .lean();

    // Save user message
    await Message.create({
      role: "user",
      content: content.trim(),
      tab_id: tab._id,
      timestamp: new Date(),
    });

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

    const openai = new OpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com",
    });

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        let fullContent = "";

        try {
          const deepseekStream = await openai.chat.completions.create({
            model: MODEL,
            max_tokens: 4096,
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
          // Save partial content if any tokens were received
          if (fullContent) {
            try {
              await Message.create({
                role: "assistant",
                content: fullContent + "\n\n[回复因错误中断]",
                tab_id: tab._id,
                timestamp: new Date(),
              });
            } catch {
              // Best effort
            }
          } else {
            // No tokens received at all — save an error message so the
            // user message isn't left orphaned in the database.
            try {
              await Message.create({
                role: "assistant",
                content:
                  "[AI 请求失败]" +
                  (err instanceof Error ? ` — ${err.message}` : ""),
                tab_id: tab._id,
                timestamp: new Date(),
              });
            } catch {
              // Best effort
            }
          }
          controller.enqueue(
            sseEvent("error", {
              message:
                err instanceof Error ? err.message : "AI 请求失败，请稍后重试",
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
