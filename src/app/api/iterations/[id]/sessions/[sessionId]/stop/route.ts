import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { stopMysqlIterationGeneration } from "@/lib/mysql-iteration-workbench";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, sessionId } = await params;
    if (!isMysqlId(id) || !isMysqlId(sessionId)) return NextResponse.json({ error: "会话参数无效" }, { status: 400 });
    const result = await stopMysqlIterationGeneration(id, sessionId, userId);
    if (result === "not-found") return NextResponse.json({ error: "会话不存在或无权访问" }, { status: 404 });
    if (result === "not-generating") return NextResponse.json({ error: "生成已结束，请刷新会话" }, { status: 409 });
    return NextResponse.json({ status: "stopped" });
  } catch (error) {
    console.error("POST iteration session stop error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
