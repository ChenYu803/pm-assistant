import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import {
  deleteMysqlProductIteration,
  findOwnedMysqlProductIteration,
  updateMysqlProductIteration,
} from "@/lib/mysql-account-workspace";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id } = await params;
    const iteration = await findOwnedMysqlProductIteration(id, userId);
    if (!iteration) return NextResponse.json({ error: "产品迭代不存在或无权访问" }, { status: 404 });
    return NextResponse.json(iteration);
  } catch (error) {
    console.error("GET /api/iterations/[id] error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const goal = body.goal === null || body.goal === undefined ? null : typeof body.goal === "string" ? body.goal.trim() : "";
    if (!displayName) return NextResponse.json({ error: "展示名称不能为空" }, { status: 400 });
    if (body.goal !== null && body.goal !== undefined && typeof body.goal !== "string") {
      return NextResponse.json({ error: "本轮目标格式无效" }, { status: 400 });
    }
    const iteration = await updateMysqlProductIteration(id, userId, displayName, goal || null);
    if (!iteration) return NextResponse.json({ error: "产品迭代不存在或无权操作" }, { status: 404 });
    return NextResponse.json(iteration);
  } catch (error) {
    console.error("PATCH /api/iterations/[id] error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id } = await params;
    const result = await deleteMysqlProductIteration(id, userId);
    if (result === "not-found") return NextResponse.json({ error: "产品迭代不存在或无权操作" }, { status: 404 });
    if (result === "generating") return NextResponse.json({ error: "迭代内有会话正在生成，请等待完成或先停止生成，再删除。", reason: "generating" }, { status: 409 });
    if (result === "writing") return NextResponse.json({ error: "迭代或项目正在保存，请等待写入完成后重试删除。", reason: "writing" }, { status: 409 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/iterations/[id] error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
