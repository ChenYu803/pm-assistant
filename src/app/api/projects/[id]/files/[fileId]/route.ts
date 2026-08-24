import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { FROZEN_DOCUMENT_LOCKED_MESSAGE, validateFileSize } from "@/lib/file-helpers";
import { isMysqlId } from "@/lib/identifiers";
import { deleteMysqlProjectFile, findOwnedMysqlProjectFile, MysqlFrozenDocumentError, serializeMysqlProjectFile, updateMysqlProjectFile } from "@/lib/mysql-project-artifacts";

function invalidFileResponse() {
  return NextResponse.json({ error: "fileId 参数无效" }, { status: 400 });
}

function invalidProjectResponse() {
  return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id: projectId, fileId } = await params;
    if (!isMysqlId(projectId)) return invalidProjectResponse();
    if (!isMysqlId(fileId)) return invalidFileResponse();
    const file = await findOwnedMysqlProjectFile(projectId, fileId, userId);
    return file ? NextResponse.json(serializeMysqlProjectFile(file)) : NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
  } catch (error) { console.error("GET /api/projects/[id]/files/[fileId] error:", error); return NextResponse.json({ error: "获取文件失败" }, { status: 500 }); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id: projectId, fileId } = await params; const { content } = await request.json();
    if (!isMysqlId(projectId)) return invalidProjectResponse();
    if (!isMysqlId(fileId)) return invalidFileResponse();
    if (typeof content !== "string") return NextResponse.json({ error: "文件内容不能为空" }, { status: 400 });
    const validation = validateFileSize(content); if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 413 });
    const file = await updateMysqlProjectFile({ projectId, fileId, userId, content });
    return file ? NextResponse.json(serializeMysqlProjectFile(file)) : NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
  } catch (error) { if (error instanceof MysqlFrozenDocumentError) return NextResponse.json({ error: FROZEN_DOCUMENT_LOCKED_MESSAGE }, { status: 409 }); console.error("PATCH /api/projects/[id]/files/[fileId] error:", error); return NextResponse.json({ error: "更新文件失败" }, { status: 500 }); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id: projectId, fileId } = await params;
    if (!isMysqlId(projectId)) return invalidProjectResponse();
    if (!isMysqlId(fileId)) return invalidFileResponse();
    const deleted = await deleteMysqlProjectFile(projectId, fileId, userId);
    return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
  } catch (error) { if (error instanceof MysqlFrozenDocumentError) return NextResponse.json({ error: FROZEN_DOCUMENT_LOCKED_MESSAGE }, { status: 409 }); console.error("DELETE /api/projects/[id]/files/[fileId] error:", error); return NextResponse.json({ error: "删除文件失败" }, { status: 500 }); }
}
