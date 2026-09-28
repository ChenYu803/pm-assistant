import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { findMysqlSnapshot } from "@/lib/mysql-project-artifacts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: projectId, snapshotId } = await params;
    if (!isMysqlId(projectId)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
    if (!isMysqlId(snapshotId)) return NextResponse.json({ error: "snapshotId 参数无效" }, { status: 400 });
    const snapshot = await findMysqlSnapshot(projectId, snapshotId, userId);
    if (!snapshot) return NextResponse.json({ error: "HTML 快照不存在" }, { status: 404 });
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode === "check") return NextResponse.json({ id: snapshot.id, version: Number(snapshot.version), created_at: snapshot.created_at });
    if (mode === "view" || mode === "download") {
      return new Response(snapshot.content, { headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": mode === "download" ? `attachment; filename="prototype-${Number(snapshot.version)}.html"` : "inline",
        "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      } });
    }
    return NextResponse.json({ id: snapshot.id, version: Number(snapshot.version), tab_id: snapshot.tab_id, content: snapshot.content, created_at: snapshot.created_at });
  } catch (error) {
    console.error("GET /api/projects/[id]/snapshots/[snapshotId] error:", error);
    return NextResponse.json({ error: "获取 HTML 快照失败" }, { status: 500 });
  }
}
