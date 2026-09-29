import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { listMysqlTaskFolders } from "@/lib/mysql-task-folders";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id } = await params;
    if (!isMysqlId(id)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
    const folders = await listMysqlTaskFolders(id, userId);
    return folders ? NextResponse.json(folders) : NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
  } catch (error) { console.error("GET /api/projects/[id]/task-folders error:", error); return NextResponse.json({ error: "任务文件夹加载失败" }, { status: 500 }); }
}
