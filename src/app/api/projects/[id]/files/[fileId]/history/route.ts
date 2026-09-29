import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { getMysqlFileHistory } from "@/lib/mysql-file-history";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: projectId, fileId } = await params;
    if (!isMysqlId(projectId) || !isMysqlId(fileId)) {
      return NextResponse.json({ error: "文件参数无效" }, { status: 400 });
    }
    const history = await getMysqlFileHistory(projectId, fileId, userId);
    return history ? NextResponse.json(history) : NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
  } catch (error) {
    console.error("GET /api/projects/[id]/files/[fileId]/history error:", error);
    return NextResponse.json({ error: "文件详情加载失败，请重试" }, { status: 500 });
  }
}
