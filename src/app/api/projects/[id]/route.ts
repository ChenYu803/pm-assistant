import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import { findOwnedProject } from "@/lib/ownership";
import {
  deleteProjectCascade,
  getCascadeDeleteTestOptions,
} from "@/lib/cascade-delete";
import { beginProjectDeletion } from "@/lib/deletion-coordination";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id } = await params;

    await dbConnect();

    const project = await findOwnedProject(id, userId);

    if (!project) {
      return NextResponse.json(
        { error: "项目不存在或无权访问" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: project._id.toString(),
      name: project.name,
      created_at: project.created_at,
    });
  } catch (error) {
    console.error("GET /api/projects/[id] error:", error);
    return NextResponse.json(
      { error: "获取项目信息失败" },
      { status: 500 }
    );
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

    await dbConnect();

    const project = await beginProjectDeletion(id, userId);

    if (!project) {
      return NextResponse.json(
        { error: "项目不存在或无权操作", code: "RESOURCE_NOT_FOUND" },
        { status: 404 }
      );
    }

    const result = await deleteProjectCascade(
      project._id,
      getCascadeDeleteTestOptions(request)
    );

    return NextResponse.json({ success: true, mode: result.mode });
  } catch (error) {
    console.error("DELETE /api/projects/[id] error:", error);
    return NextResponse.json(
      { error: "删除项目未完成，请重试", code: "CASCADE_DELETE_FAILED" },
      { status: 500 }
    );
  }
}
