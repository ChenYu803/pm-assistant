import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import { parseObjectId, findOwnedWorkRecord } from "@/lib/ownership";
import {
  deleteWorkRecordCascade,
  getCascadeDeleteTestOptions,
} from "@/lib/cascade-delete";
import {
  acquireWorkRecordWriteLease,
  beginWorkRecordDeletion,
} from "@/lib/deletion-coordination";

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
        { error: "工作记录不存在", code: "RESOURCE_NOT_FOUND" },
        { status: 404 }
      );
    }

    await dbConnect();

    const deletion = await beginWorkRecordDeletion(id, userId);
    if (!deletion) {
      return NextResponse.json(
        { error: "工作记录不存在或无权操作", code: "RESOURCE_NOT_FOUND" },
        { status: 404 }
      );
    }

    let result;
    try {
      result = await deleteWorkRecordCascade(
        deletion.workRecord._id,
        getCascadeDeleteTestOptions(request)
      );
    } finally {
      await deletion.release();
    }

    return NextResponse.json({ success: true, mode: result.mode });
  } catch (error) {
    console.error("DELETE /api/work-records/[id] error:", error);
    return NextResponse.json(
      { error: "删除工作记录未完成，请重试", code: "CASCADE_DELETE_FAILED" },
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

    const writeLease = await acquireWorkRecordWriteLease(id, userId);

    if (!writeLease) {
      return NextResponse.json(
        { error: "工作记录不存在或无权操作" },
        { status: 404 }
      );
    }
    try {
      const workRecord = writeLease.workRecord;
      workRecord.name = name.trim();
      await workRecord.save();

      return NextResponse.json({
        id: workRecord._id.toString(),
        name: workRecord.name,
        project_id: workRecord.project_id.toString(),
        created_at: workRecord.created_at,
      });
    } finally {
      await writeLease.release();
    }
  } catch (error) {
    console.error("PATCH /api/work-records/[id] error:", error);
    return NextResponse.json(
      { error: "更新工作记录失败" },
      { status: 500 }
    );
  }
}
