import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { getMysqlIterationWorkbench, setMysqlIterationCurrentStage, WORKBENCH_STAGES, type WorkbenchStage } from "@/lib/mysql-iteration-workbench";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id } = await params;
    if (!isMysqlId(id)) return NextResponse.json({ error: "产品迭代参数无效" }, { status: 400 });
    const workbench = await getMysqlIterationWorkbench(id, userId);
    return workbench ? NextResponse.json(workbench) : NextResponse.json({ error: "产品迭代不存在或无权访问" }, { status: 404 });
  } catch (error) {
    console.error("GET /api/iterations/[id]/workbench error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const stage = body?.stage;
    if (!isMysqlId(id)) return NextResponse.json({ error: "产品迭代参数无效" }, { status: 400 });
    if (!WORKBENCH_STAGES.includes(stage)) return NextResponse.json({ error: "阶段参数无效" }, { status: 400 });
    if (body?.sessionId !== undefined && (typeof body.sessionId !== "string" || !isMysqlId(body.sessionId))) {
      return NextResponse.json({ error: "阶段会话参数无效" }, { status: 400 });
    }
    const updated = await setMysqlIterationCurrentStage(id, userId, stage as WorkbenchStage, body?.sessionId);
    return updated ? NextResponse.json(updated) : NextResponse.json({ error: "产品迭代或阶段会话不存在或无权访问" }, { status: 404 });
  } catch (error) {
    console.error("PATCH /api/iterations/[id]/workbench error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
