import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { deleteMysqlIterationSession, findOwnedIterationSession } from "@/lib/mysql-iteration-workbench";

type Context = { params: Promise<{ id: string; sessionId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, sessionId } = await params;
    if (!isMysqlId(id) || !isMysqlId(sessionId)) return NextResponse.json({ error: "会话参数无效" }, { status: 400 });
    const session = await findOwnedIterationSession(id, sessionId, userId);
    return session ? NextResponse.json({ id: session.id, iteration_id: session.iteration_id, stage: session.stage, title: session.title, created_at: session.created_at, updated_at: session.updated_at }) : NextResponse.json({ error: "会话不存在或无权访问" }, { status: 404 });
  } catch (error) {
    console.error("GET /api/iterations/[id]/sessions/[sessionId] error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, sessionId } = await params;
    if (!isMysqlId(id) || !isMysqlId(sessionId)) return NextResponse.json({ error: "会话参数无效" }, { status: 400 });
    const result = await deleteMysqlIterationSession(id, sessionId, userId);
    if (result === "not-found") return NextResponse.json({ error: "会话不存在或无权访问" }, { status: 404 });
    if (result === "generating") return NextResponse.json({ error: "会话仍有消息生成中，暂不能删除" }, { status: 409 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/iterations/[id]/sessions/[sessionId] error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
