import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
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
    const result = await generateMysqlIterationMessage({ iterationId: id, sessionId, userId, editMessageId: messageId, content: body.content });
    if (result.kind === "not-found") return NextResponse.json({ error: "会话不存在或无权访问" }, { status: 404 });
    if (result.kind === "not-configured") return NextResponse.json({ error: "AI 服务未配置" }, { status: 500 });
    if (result.kind === "generating") return NextResponse.json({ error: "当前会话已有消息生成中，请稍后重试" }, { status: 409 });
    if (result.kind === "invalid-edit") return NextResponse.json({ error: "只能编辑最后一条用户消息" }, { status: 409 });
    if (result.kind === "generation-failed") return NextResponse.json({ error: result.error, userMessage: result.userMessage, assistantMessageId: result.assistantMessageId }, { status: 502 });
    return NextResponse.json({ userMessage: result.userMessage, assistantMessage: result.assistantMessage }, { status: 200 });
  } catch (error) {
    console.error("PATCH iteration session message error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
