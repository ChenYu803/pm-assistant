import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import PrototypeSnapshot from "@/models/PrototypeSnapshot";
import { findOwnedProject, parseObjectId } from "@/lib/ownership";
import { isMysqlId } from "@/lib/identifiers";
import { findMysqlSnapshot } from "@/lib/mysql-project-artifacts";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; snapshotId: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: projectId, snapshotId } = await params;
    if (isMysqlId(projectId)) {
      if (!isMysqlId(snapshotId)) return NextResponse.json({ error: "snapshotId 参数无效" }, { status: 400 });
      const snapshot = await findMysqlSnapshot(projectId, snapshotId, userId);
      if (!snapshot) return NextResponse.json({ error: "HTML 快照不存在" }, { status: 404 });
      return NextResponse.json({ id: snapshot.id, version: Number(snapshot.version), tab_id: snapshot.tab_id, content: snapshot.content, created_at: snapshot.created_at });
    }
    if (!parseObjectId(snapshotId)) return NextResponse.json({ error: "snapshotId 参数无效" }, { status: 400 });
    await dbConnect();
    const project = await findOwnedProject(projectId, userId);
    if (!project) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
    const snapshot = await PrototypeSnapshot.findOne({ _id: parseObjectId(snapshotId), project_id: project._id }).lean();
    if (!snapshot) return NextResponse.json({ error: "HTML 快照不存在" }, { status: 404 });
    return NextResponse.json({
      id: snapshot._id.toString(),
      version: snapshot.version,
      tab_id: snapshot.tab_id?.toString(),
      content: snapshot.content,
      created_at: snapshot.created_at,
    });
  } catch (error) {
    console.error("GET /api/projects/[id]/snapshots/[snapshotId] error:", error);
    return NextResponse.json({ error: "获取 HTML 快照失败" }, { status: 500 });
  }
}
