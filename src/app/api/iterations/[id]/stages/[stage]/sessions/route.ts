import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { createMysqlIterationSession, WORKBENCH_STAGES } from "@/lib/mysql-iteration-workbench";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; stage: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, stage } = await params;
    if (!WORKBENCH_STAGES.includes(stage as (typeof WORKBENCH_STAGES)[number])) return NextResponse.json({ error: "阶段参数无效" }, { status: 400 });
    const session = await createMysqlIterationSession(id, userId, stage as (typeof WORKBENCH_STAGES)[number]);
    if (!session) return NextResponse.json({ error: "产品迭代不存在或无权访问" }, { status: 404 });
    return NextResponse.json({ session: { id: session.id, title: session.title, updatedAt: session.updated_at } }, { status: 201 });
  } catch (error) {
    console.error("POST /api/iterations/[id]/stages/[stage]/sessions error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
