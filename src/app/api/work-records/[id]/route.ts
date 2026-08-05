import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import WorkRecord from "@/models/WorkRecord";
import { parseObjectId, findOwnedProject, findOwnedWorkRecord } from "@/lib/ownership";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id } = await params;

    await dbConnect();

    const workRecord = await findOwnedWorkRecord(id, userId);
    if (!workRecord) {
      return NextResponse.json(
        { error: "工作记录不存在或无权访问" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: workRecord._id.toString(),
      name: workRecord.name,
      project_id: workRecord.project_id.toString(),
      created_at: workRecord.created_at,
    });
  } catch (error) {
    console.error("GET /api/work-records/[id] error:", error);
    return NextResponse.json(
      { error: "获取工作记录失败" },
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

    const oid = parseObjectId(id);
    if (!oid) {
      return NextResponse.json(
        { error: "工作记录不存在" },
        { status: 404 }
      );
    }

    await dbConnect();

    // Find the work record
    const workRecord = await WorkRecord.findById(oid);

    if (!workRecord) {
      return NextResponse.json(
        { error: "工作记录不存在" },
        { status: 404 }
      );
    }

    // Verify project belongs to user
    const project = await findOwnedProject(
      workRecord.project_id.toString(),
      userId
    );

    if (!project) {
      return NextResponse.json(
        { error: "无权操作此工作记录" },
        { status: 403 }
      );
    }

    await workRecord.deleteOne();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/work-records/[id] error:", error);
    return NextResponse.json(
      { error: "删除工作记录失败" },
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

    const oid = parseObjectId(id);
    if (!oid) {
      return NextResponse.json(
        { error: "工作记录不存在" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "名称不能为空" },
        { status: 400 }
      );
    }

    await dbConnect();

    const workRecord = await WorkRecord.findById(oid);

    if (!workRecord) {
      return NextResponse.json(
        { error: "工作记录不存在" },
        { status: 404 }
      );
    }

    // Verify project belongs to user
    const project = await findOwnedProject(
      workRecord.project_id.toString(),
      userId
    );

    if (!project) {
      return NextResponse.json(
        { error: "无权操作此工作记录" },
        { status: 403 }
      );
    }

    workRecord.name = name.trim();
    await workRecord.save();

    return NextResponse.json({
      id: workRecord._id.toString(),
      name: workRecord.name,
      project_id: workRecord.project_id.toString(),
      created_at: workRecord.created_at,
    });
  } catch (error) {
    console.error("PATCH /api/work-records/[id] error:", error);
    return NextResponse.json(
      { error: "更新工作记录失败" },
      { status: 500 }
    );
  }
}
