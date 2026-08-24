import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { findMysqlSnapshot } from "@/lib/mysql-project-artifacts";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: projectId, snapshotId } = await params;
    if (!isMysqlId(projectId)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
    if (!isMysqlId(snapshotId)) return NextResponse.json({ error: "snapshotId 参数无效" }, { status: 400 });
    const snapshot = await findMysqlSnapshot(projectId, snapshotId, userId);
    if (!snapshot) return NextResponse.json({ error: "HTML 快照不存在" }, { status: 404 });
    return NextResponse.json({ id: snapshot.id, version: Number(snapshot.version), tab_id: snapshot.tab_id, content: snapshot.content, created_at: snapshot.created_at });
  } catch (error) {
    console.error("GET /api/projects/[id]/snapshots/[snapshotId] error:", error);
    return NextResponse.json({ error: "获取 HTML 快照失败" }, { status: 500 });
  }
}
