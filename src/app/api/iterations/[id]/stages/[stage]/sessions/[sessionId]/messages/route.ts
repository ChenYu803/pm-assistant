import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { createIterationGenerationStream, type GenerationResponse } from "@/lib/iteration-generation-stream";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { findOwnedIterationSession, generateMysqlIterationMessage, listMysqlIterationMessages, WORKBENCH_STAGES } from "@/lib/mysql-iteration-workbench";

type Params = Promise<{ id: string; stage: string; sessionId: string }>;

export async function GET(_request: Request, { params }: { params: Params }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, stage, sessionId } = await params;
    if (!WORKBENCH_STAGES.includes(stage as (typeof WORKBENCH_STAGES)[number])) return NextResponse.json({ error: "阶段参数无效" }, { status: 400 });
    const session = await findOwnedIterationSession(id, sessionId, userId);
    if (!session || session.stage !== stage) return NextResponse.json({ error: "阶段会话不存在或无权访问" }, { status: 404 });
    return NextResponse.json({ messages: await listMysqlIterationMessages(sessionId) });
  } catch (error) {
    console.error("GET iteration session messages error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, stage, sessionId } = await params;
    if (!WORKBENCH_STAGES.includes(stage as (typeof WORKBENCH_STAGES)[number])) return NextResponse.json({ error: "阶段参数无效" }, { status: 400 });
    const session = await findOwnedIterationSession(id, sessionId, userId);
    if (!session || session.stage !== stage) return NextResponse.json({ error: "阶段会话不存在或无权访问" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (typeof body.content !== "string" && typeof body.regenerateMessageId !== "string") return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
    const runGeneration = async (onContent: (content: string, messageId?: string) => void, signal?: AbortSignal): Promise<GenerationResponse> => {
      try {
        const result = await generateMysqlIterationMessage({ iterationId: id, sessionId, userId, content: body.content, regenerateMessageId: body.regenerateMessageId, editMessageId: body.editMessageId,
          replayDelayMs: process.env.NODE_ENV !== "production" && request.headers.get("x-pm-verify-stream-delay") === "1" ? 30000 : undefined,
          forceSnapshotFailure: process.env.NODE_ENV !== "production" && request.headers.get("x-pm-verify-snapshot-failure") === "1",
          onContentChunk: onContent, signal });
        if (result.kind === "not-found") return { status: 404, body: { error: "阶段会话不存在或无权访问" } };
        if (result.kind === "empty") return { status: 400, body: { error: "消息内容不能为空" } };
        if (result.kind === "not-configured") return { status: 503, body: { error: "AI 服务未配置，请联系管理员" } };
        if (result.kind === "generating") return { status: 409, body: { error: "当前会话已有消息生成中，请稍后重试" } };
        if (result.kind === "stage-completed") return { status: 409, body: { error: "本阶段已完成，请先重新打开阶段" } };
        if (result.kind === "generation-stopped") return { status: 409, body: { error: "生成已停止", messages: await listMysqlIterationMessages(sessionId) } };
        if (result.kind === "invalid-edit" || result.kind === "invalid-regenerate") return { status: 409, body: { error: result.kind === "invalid-edit" ? "只能修改最后一条用户消息" : "只能重新生成最后一条 Agent 回复" } };
        if (result.kind === "conflict") return { status: 409, body: { error: "当前会话已被其他请求更新，请刷新后重试" } };
        if (result.kind === "generation-failed") return { status: 502, body: { error: `${result.error}；可重试生成。`, messages: await listMysqlIterationMessages(sessionId) } };
        return { status: 200, body: { messages: await listMysqlIterationMessages(sessionId), userMessage: result.userMessage, assistantMessage: result.assistantMessage } };
      } catch (error) {
        console.error("POST iteration session messages error:", error);
        return { status: 500, body: { error: mysqlUnavailableMessage() } };
      }
    };
    if (request.headers.get("accept")?.includes("text/event-stream")) {
      return createIterationGenerationStream(runGeneration, 15_000, request.signal);
    }
    const result = await runGeneration(() => undefined);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("POST iteration session messages error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
