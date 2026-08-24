import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { createMysqlWorkRecord, listMysqlWorkRecords } from "@/lib/mysql-account-workspace";
import { mysqlUnavailableMessage } from "@/lib/mysql";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: projectId } = await params;

    const workRecords = await listMysqlWorkRecords(projectId, userId);
    if (!workRecords) {
      return NextResponse.json(
        { error: "项目不存在或无权访问" },
        { status: 404 }
      );
    }

    return NextResponse.json(workRecords);
  } catch (error) {
    console.error("GET /api/projects/[id]/work-records error:", error);
    return NextResponse.json(
      { error: mysqlUnavailableMessage() },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: projectId } = await params;

    const body = await request.json().catch(() => ({}));
    const { name } = body as { name?: unknown };
    const trimmedName = typeof name === "string" ? name.trim() : "";
    const workRecord = await createMysqlWorkRecord(projectId, userId, trimmedName || "未命名");
    if (!workRecord) {
      return NextResponse.json(
        { error: "项目不存在或无权操作" },
        { status: 404 }
      );
    }

    return NextResponse.json(workRecord, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects/[id]/work-records error:", error);
    return NextResponse.json(
      { error: mysqlUnavailableMessage() },
      { status: 500 }
    );
  }
}
