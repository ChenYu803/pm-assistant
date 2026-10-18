import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { createIterationGenerationStream, type GenerationResponse } from "@/lib/iteration-generation-stream";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { generateMysqlIterationMessage } from "@/lib/mysql-iteration-workbench";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; sessionId: string; messageId: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, sessionId, messageId } = await params;
    const body = await request.json().catch(() => null);
    if (![id, sessionId, messageId].every(isMysqlId)) return NextResponse.json({ error: "消息参数无效" }, { status: 400 });
    if (typeof body?.content !== "string" || !body.content.trim()) return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
    const runGeneration = async (onContent: (content: string, messageId?: string) => void, signal?: AbortSignal): Promise<GenerationResponse> => {
      try {
        const result = await generateMysqlIterationMessage({ iterationId: id, sessionId, userId, editMessageId: messageId, content: body.content, onContentChunk: onContent, signal,
          replayDelayMs: process.env.AI_MODE === "replay" && process.env.NODE_ENV !== "production" && request.headers.get("x-pm-verify-stream-delay") === "1" ? 30000 : undefined });
        if (result.kind === "not-found") return { status: 404, body: { error: "会话不存在或无权访问" } };
        if (result.kind === "not-configured") return { status: 500, body: { error: "AI 服务未配置" } };
        if (result.kind === "generating") return { status: 409, body: { error: "当前会话已有消息生成中，请稍后重试" } };
        if (result.kind === "invalid-edit") return { status: 409, body: { error: "只能编辑最后一条用户消息" } };
        if (result.kind === "conflict") return { status: 409, body: { error: "当前会话已被其他请求更新，请刷新后重试" } };
        if (result.kind === "stage-completed") return { status: 409, body: { error: "本阶段已完成，请先重新打开阶段" } };
        if (result.kind === "generation-stopped") return { status: 409, body: { error: "生成已停止" } };
        if (result.kind === "generation-failed") return { status: 502, body: { error: result.error, userMessage: result.userMessage, assistantMessageId: result.assistantMessageId } };
        return { status: 200, body: { userMessage: result.userMessage, assistantMessage: result.assistantMessage } };
      } catch (error) {
        console.error("PATCH iteration session message error:", error);
        return { status: 500, body: { error: mysqlUnavailableMessage() } };
      }
    };
    if (request.headers.get("accept")?.includes("text/event-stream")) return createIterationGenerationStream(runGeneration, 15_000, request.signal);
    const result = await runGeneration(() => undefined);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("PATCH iteration session message error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
