import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import {
  createMysqlProductIteration,
  listMysqlProductIterations,
} from "@/lib/mysql-account-workspace";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: projectId } = await params;
    const iterations = await listMysqlProductIterations(projectId, userId);
    if (!iterations) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
    return NextResponse.json(iterations);
  } catch (error) {
    console.error("GET /api/projects/[id]/iterations error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: projectId } = await params;
    const body = await request.json().catch(() => ({}));
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const goal = body.goal === null || body.goal === undefined ? null : typeof body.goal === "string" ? body.goal.trim() : "";
    if (!displayName) return NextResponse.json({ error: "展示名称不能为空" }, { status: 400 });
    if (body.goal !== null && body.goal !== undefined && typeof body.goal !== "string") {
      return NextResponse.json({ error: "本轮目标格式无效" }, { status: 400 });
    }
    const iteration = await createMysqlProductIteration(projectId, userId, displayName, goal || null);
    if (!iteration) return NextResponse.json({ error: "项目不存在或无权操作" }, { status: 404 });
    return NextResponse.json(iteration, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects/[id]/iterations error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
