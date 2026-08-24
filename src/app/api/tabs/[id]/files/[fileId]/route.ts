import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { removeMysqlContextFile } from "@/lib/mysql-project-artifacts";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: tabId, fileId } = await params;
    if (!isMysqlId(tabId) || !isMysqlId(fileId)) return NextResponse.json({ error: "fileId 参数无效" }, { status: 400 });
    const result = await removeMysqlContextFile(tabId, fileId, userId);
    if (result.kind === "tab-not-found") return NextResponse.json({ error: "标签页不存在或无权访问" }, { status: 404 });
    if (result.kind === "file-not-found") return NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
    if (result.kind === "not-loaded") return NextResponse.json({ error: "该文件未在上下文中" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/tabs/[id]/files/[fileId] error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
