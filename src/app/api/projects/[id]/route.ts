import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import WorkRecord from "@/models/WorkRecord";
import { findOwnedProject } from "@/lib/ownership";

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

    const project = await findOwnedProject(id, userId);

    if (!project) {
      return NextResponse.json(
        { error: "项目不存在或无权操作" },
        { status: 404 }
      );
    }

    // Delete all work records under this project
    await WorkRecord.deleteMany({ project_id: project._id });

    // Delete the project
    await project.deleteOne();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/projects/[id] error:", error);
    return NextResponse.json(
      { error: "删除项目失败" },
      { status: 500 }
    );
  }
}
