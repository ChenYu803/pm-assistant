import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { downloadMysqlTicketSet } from "@/lib/mysql-project-artifacts";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; version: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: projectId, version: versionText } = await params;
    if (!isMysqlId(projectId)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
    if (!/^\d+$/u.test(versionText)) return NextResponse.json({ error: "ticket 版本参数无效" }, { status: 400 });
    const version = Number(versionText);
    const result = await downloadMysqlTicketSet(projectId, userId, version);
    if (!result) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
    if (result.kind === "version-not-found") return NextResponse.json({ error: "ticket 版本不存在" }, { status: 404 });
    return new NextResponse(JSON.stringify({ version, currentVersion: result.currentVersion, files: result.files }, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''tickets-v${version}.json`,
      },
    });
  } catch (error) {
    console.error("GET /api/projects/[id]/ticket-sets/[version]/download error:", error);
    return NextResponse.json({ error: "下载 ticket 版本失败" }, { status: 500 });
  }
}
