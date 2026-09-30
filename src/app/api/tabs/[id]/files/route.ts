import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { addMysqlContextFile, listMysqlLoadedContextFiles } from "@/lib/mysql-project-artifacts";
import { findOwnedMysqlConversationTab } from "@/lib/mysql-conversation";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: tabId } = await params;
    if (!isMysqlId(tabId)) return NextResponse.json({ error: "标签页参数无效" }, { status: 400 });
    const tab = await findOwnedMysqlConversationTab(tabId, userId);
    if (!tab) return NextResponse.json({ error: "标签页不存在或无权访问" }, { status: 404 });
    const files = await listMysqlLoadedContextFiles(tabId, tab.project_id);
    return NextResponse.json({ files: files.map(({ _id, filename, project_id, created_at, updated_at }) => ({ id: _id, filename, project_id, created_at, updated_at })) });
  } catch (error) {
    console.error("GET /api/tabs/[id]/files error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: tabId } = await params;
    const { file_id: fileId } = await request.json();
    if (!fileId || typeof fileId !== "string") return NextResponse.json({ error: "file_id 不能为空" }, { status: 400 });
    if (!isMysqlId(tabId)) return NextResponse.json({ error: "标签页参数无效" }, { status: 400 });
    if (!isMysqlId(fileId)) return NextResponse.json({ error: "fileId 参数无效" }, { status: 400 });
    const result = await addMysqlContextFile(tabId, fileId, userId);
    if (result.kind === "iteration-required") return NextResponse.json({ error: "请在当前产品迭代的阶段会话中加入上下文" }, { status: 409 });
    if (result.kind === "tab-not-found") return NextResponse.json({ error: "标签页不存在或无权访问" }, { status: 404 });
    if (result.kind === "file-not-found") return NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
    if (result.kind === "not-loadable") return NextResponse.json({ error: "工作文档/概念版为中间过程产物，不可加载进 Agent 上下文" }, { status: 400 });
    if (result.kind === "duplicate") return NextResponse.json({ error: "文件已在上下文中" }, { status: 409 });
    return NextResponse.json({ id: `${tabId}:${fileId}`, file_id: fileId, filename: result.file.filename }, { status: 201 });
  } catch (error) {
    console.error("POST /api/tabs/[id]/files error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
