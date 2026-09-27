import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { completeMysqlIterationStage, WORKBENCH_STAGES, type WorkbenchStage } from "@/lib/mysql-iteration-workbench";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; stage: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, stage } = await params;
    if (!isMysqlId(id) || !WORKBENCH_STAGES.includes(stage as WorkbenchStage)) {
      return NextResponse.json({ error: "阶段参数无效" }, { status: 400 });
    }
    const result = await completeMysqlIterationStage(id, userId, stage as WorkbenchStage);
    if (result === "not-found") return NextResponse.json({ error: "产品迭代不存在或无权访问" }, { status: 404 });
    if (result === "not-in-progress") return NextResponse.json({ error: "请先打开阶段会话，再完成本阶段" }, { status: 409 });
    if (result === "generating") return NextResponse.json({ error: "本阶段仍有 Agent 在生成，请等待结束或先停止生成" }, { status: 409 });
    return NextResponse.json({ stage, status: "completed" });
  } catch (error) {
    console.error("POST iteration stage complete error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
