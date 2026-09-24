import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { findOwnedIterationSession, listMysqlIterationContext, mutateMysqlIterationContext, WORKBENCH_STAGES } from "@/lib/mysql-iteration-workbench";

type Params = Promise<{ id: string; stage: string; sessionId: string }>;

async function authorize(iterationId: string, stage: string, sessionId: string, userId: string) {
  if (!WORKBENCH_STAGES.includes(stage as (typeof WORKBENCH_STAGES)[number])) return null;
  const session = await findOwnedIterationSession(iterationId, sessionId, userId);
  return session?.stage === stage ? session : null;
}

export async function GET(_request: Request, { params }: { params: Params }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, stage, sessionId } = await params;
    if (!(await authorize(id, stage, sessionId, userId))) return NextResponse.json({ error: "阶段会话不存在或无权访问" }, { status: 404 });
    const files = await listMysqlIterationContext(id, sessionId, userId);
    return NextResponse.json({ files, fileIds: files?.map((file) => file.id) ?? [] });
  } catch (error) {
    console.error("GET iteration session context error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Params }) {
  return mutate(request, params, "add");
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  return mutate(request, params, "remove");
}

async function mutate(request: Request, params: Params, action: "add" | "remove") {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, stage, sessionId } = await params;
    if (!(await authorize(id, stage, sessionId, userId))) return NextResponse.json({ error: "阶段会话不存在或无权访问" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (typeof body.fileId !== "string") return NextResponse.json({ error: "文件参数无效" }, { status: 400 });
    const result = await mutateMysqlIterationContext(id, sessionId, body.fileId, userId, action);
    if (result.kind === "file-not-found") return NextResponse.json({ error: "项目文件不存在" }, { status: 404 });
    if (result.kind === "not-loadable") return NextResponse.json({ error: "此类过程文件不能加入上下文" }, { status: 400 });
    if (result.kind === "session-not-found") return NextResponse.json({ error: "阶段会话不存在或无权访问" }, { status: 404 });
    const files = await listMysqlIterationContext(id, sessionId, userId) ?? [];
    return NextResponse.json({ files, fileIds: files.map((file) => file.id), duplicate: result.kind === "duplicate" });
  } catch (error) {
    console.error("Mutate iteration session context error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
