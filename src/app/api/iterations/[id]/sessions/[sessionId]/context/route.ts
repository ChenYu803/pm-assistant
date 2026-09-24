import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { listMysqlIterationContext, mutateMysqlIterationContext } from "@/lib/mysql-iteration-workbench";

type Context = { params: Promise<{ id: string; sessionId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, sessionId } = await params;
    if (!isMysqlId(id) || !isMysqlId(sessionId)) return NextResponse.json({ error: "会话参数无效" }, { status: 400 });
    const files = await listMysqlIterationContext(id, sessionId, userId);
    return files ? NextResponse.json({ files }) : NextResponse.json({ error: "会话不存在或无权访问" }, { status: 404 });
  } catch (error) {
    console.error("GET iteration session context error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Context) {
  return mutate(request, params, "add");
}

export async function DELETE(request: Request, { params }: Context) {
  return mutate(request, params, "remove");
}

async function mutate(request: Request, params: Context["params"], action: "add" | "remove") {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, sessionId } = await params;
    const body = await request.json().catch(() => null);
    const fileId = body?.fileId;
    if (!isMysqlId(id) || !isMysqlId(sessionId) || typeof fileId !== "string" || !isMysqlId(fileId)) return NextResponse.json({ error: "文件参数无效" }, { status: 400 });
    const result = await mutateMysqlIterationContext(id, sessionId, fileId, userId, action);
    if (result.kind === "session-not-found") return NextResponse.json({ error: "会话不存在或无权访问" }, { status: 404 });
    if (result.kind === "file-not-found") return NextResponse.json({ error: "文件不存在或不属于当前项目" }, { status: 404 });
    if (result.kind === "not-loadable") return NextResponse.json({ error: "中间过程文件不可加载进上下文" }, { status: 400 });
    if (result.kind === "duplicate") return NextResponse.json({ error: "文件已在当前会话上下文中" }, { status: 409 });
    if (result.kind === "not-loaded") return NextResponse.json({ error: "文件不在当前会话上下文中" }, { status: 404 });
    return NextResponse.json({ file: result.file }, { status: action === "add" ? 201 : 200 });
  } catch (error) {
    console.error(`${action} iteration session context error:`, error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
