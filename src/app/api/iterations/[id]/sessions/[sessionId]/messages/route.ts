import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { findOwnedIterationSession, generateMysqlIterationMessage, listMysqlIterationMessages } from "@/lib/mysql-iteration-workbench";

type Context = { params: Promise<{ id: string; sessionId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, sessionId } = await params;
    if (!isMysqlId(id) || !isMysqlId(sessionId)) return NextResponse.json({ error: "会话参数无效" }, { status: 400 });
    if (!(await findOwnedIterationSession(id, sessionId, userId))) return NextResponse.json({ error: "会话不存在或无权访问" }, { status: 404 });
    return NextResponse.json({ messages: await listMysqlIterationMessages(sessionId) });
  } catch (error) {
    console.error("GET iteration session messages error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, sessionId } = await params;
    const body = await request.json().catch(() => null);
    if (!isMysqlId(id) || !isMysqlId(sessionId)) return NextResponse.json({ error: "会话参数无效" }, { status: 400 });
    const result = await generateMysqlIterationMessage({
      iterationId: id, sessionId, userId,
      ...(typeof body?.content === "string" ? { content: body.content } : {}),
      ...(typeof body?.regenerateMessageId === "string" ? { regenerateMessageId: body.regenerateMessageId } : {}),
    });
    if (result.kind === "not-found") return NextResponse.json({ error: "会话不存在或无权访问" }, { status: 404 });
    if (result.kind === "not-configured") return NextResponse.json({ error: "AI 服务未配置" }, { status: 500 });
    if (result.kind === "empty") return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
    if (result.kind === "invalid-regenerate") return NextResponse.json({ error: "只能重新生成最后一条已完成的 Agent 消息" }, { status: 409 });
    if (result.kind === "generation-failed") return NextResponse.json({ error: result.error, userMessage: result.userMessage, assistantMessageId: result.assistantMessageId }, { status: 502 });
    return NextResponse.json({ userMessage: result.userMessage, assistantMessage: result.assistantMessage }, { status: 201 });
  } catch (error) {
    console.error("POST iteration session messages error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
