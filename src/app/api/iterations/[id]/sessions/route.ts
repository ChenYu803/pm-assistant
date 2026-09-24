import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { createMysqlIterationSession, findOwnedWorkbenchIteration, WORKBENCH_STAGES, type WorkbenchStage } from "@/lib/mysql-iteration-workbench";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id } = await params;
    if (!isMysqlId(id)) return NextResponse.json({ error: "产品迭代参数无效" }, { status: 400 });
    const iteration = await findOwnedWorkbenchIteration(id, userId);
    if (!iteration) return NextResponse.json({ error: "产品迭代不存在或无权访问" }, { status: 404 });
    const workbench = (await import("@/lib/mysql-iteration-workbench")).getMysqlIterationWorkbench;
    return NextResponse.json({ sessions: (await workbench(id, userId))?.stages.flatMap((stage) => stage.sessions.map((session) => ({ ...session, stage: stage.key }))) ?? [] });
  } catch (error) {
    console.error("GET /api/iterations/[id]/sessions error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!isMysqlId(id)) return NextResponse.json({ error: "产品迭代参数无效" }, { status: 400 });
    if (!WORKBENCH_STAGES.includes(body?.stage)) return NextResponse.json({ error: "阶段参数无效" }, { status: 400 });
    const session = await createMysqlIterationSession(id, userId, body.stage as WorkbenchStage);
    return session ? NextResponse.json(session, { status: 201 }) : NextResponse.json({ error: "产品迭代不存在或无权访问" }, { status: 404 });
  } catch (error) {
    console.error("POST /api/iterations/[id]/sessions error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
