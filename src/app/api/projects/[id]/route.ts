import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { findOwnedMysqlProject, renameMysqlProject } from "@/lib/mysql-account-workspace";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { deleteMysqlProjectCascade } from "@/lib/mysql-cascade-delete";
import { getCascadeDeleteTestOptions } from "@/lib/mysql-cascade-delete";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id } = await params;
    if (!isMysqlId(id)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });

    const project = await findOwnedMysqlProject(id, userId);

    if (!project) {
      return NextResponse.json(
        { error: "项目不存在或无权访问" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: project.id,
      name: project.name,
      created_at: project.created_at,
    });
  } catch (error) {
    console.error("GET /api/projects/[id] error:", error);
    return NextResponse.json(
      { error: mysqlUnavailableMessage() },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id } = await params;
    if (!isMysqlId(id)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });

    const project = await renameMysqlProject(id, userId, name);
    if (!project) return NextResponse.json({ error: "项目不存在或无权操作" }, { status: 404 });
    return NextResponse.json({ id: project.id, name: project.name, created_at: project.created_at });
  } catch (error) {
    console.error("PATCH /api/projects/[id] error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id } = await params;
    if (!isMysqlId(id)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });

    const result = await deleteMysqlProjectCascade(id, userId, getCascadeDeleteTestOptions(request));
    if (!result) {
      return NextResponse.json(
        { error: "项目不存在或无权操作", code: "RESOURCE_NOT_FOUND" },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, mode: result.mode });
  } catch (error) {
    console.error("DELETE /api/projects/[id] error:", error);
    return NextResponse.json(
      { error: "删除项目未完成，请重试", code: "CASCADE_DELETE_FAILED" },
      { status: 500 }
    );
  }
}
