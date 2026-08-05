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

    const { id: projectId } = await params;

    await dbConnect();

    const project = await findOwnedProject(projectId, userId);

    if (!project) {
      return NextResponse.json(
        { error: "项目不存在或无权访问" },
        { status: 404 }
      );
    }

    const workRecords = await WorkRecord.find({ project_id: project._id })
      .sort({ created_at: -1 })
      .lean();

    return NextResponse.json(
      workRecords.map((w) => ({
        id: w._id.toString(),
        name: w.name,
        project_id: w.project_id.toString(),
        created_at: w.created_at,
      }))
    );
  } catch (error) {
    console.error("GET /api/projects/[id]/work-records error:", error);
    return NextResponse.json(
      { error: "获取工作记录列表失败" },
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

    await dbConnect();

    const project = await findOwnedProject(projectId, userId);

    if (!project) {
      return NextResponse.json(
        { error: "项目不存在或无权操作" },
        { status: 404 }
      );
    }

    const workRecord = await WorkRecord.create({
      project_id: project._id,
    });

    return NextResponse.json(
      {
        id: workRecord._id.toString(),
        name: workRecord.name,
        project_id: workRecord.project_id.toString(),
        created_at: workRecord.created_at,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/projects/[id]/work-records error:", error);
    return NextResponse.json(
      { error: "创建工作记录失败" },
      { status: 500 }
    );
  }
}
