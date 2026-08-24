import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import ProjectFile from "@/models/ProjectFile";
import { findOwnedProject } from "@/lib/ownership";
import { ticketSetVersion } from "@/lib/file-helpers";
import { isMysqlId } from "@/lib/identifiers";
import { downloadMysqlTicketSet } from "@/lib/mysql-project-artifacts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, version: rawVersion } = await params;
    if (!/^\d+$/u.test(rawVersion)) {
      return NextResponse.json({ error: "ticket 版本参数无效" }, { status: 400 });
    }
    const version = Number(rawVersion);
    if (isMysqlId(id)) {
      const result = await downloadMysqlTicketSet(id, userId, version);
      if (!result) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
      if (result.kind === "version-not-found") return NextResponse.json({ error: "ticket 版本不存在" }, { status: 404 });
      return new NextResponse(JSON.stringify({ version, currentVersion: result.currentVersion, files: result.files }, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''tickets-v${version}.json` },
      });
    }
    await dbConnect();
    const project = await findOwnedProject(id, userId);
    if (!project) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
    const files = await ProjectFile.find({ project_id: project._id, filename: /^issues\//u })
      .sort({ filename: 1 })
      .lean();
    const selected = files.filter((file) => ticketSetVersion(file.filename) === version);
    if (selected.length === 0) return NextResponse.json({ error: "ticket 版本不存在" }, { status: 404 });
    const payload = {
      version,
      currentVersion: Math.max(...files.map((file) => ticketSetVersion(file.filename))),
      files: selected.map((file) => ({ filename: file.filename, content: file.content })),
    };
    return new NextResponse(JSON.stringify(payload, null, 2), {
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
