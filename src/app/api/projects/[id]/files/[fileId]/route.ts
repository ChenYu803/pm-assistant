import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { FROZEN_DOCUMENT_LOCKED_MESSAGE, stripChangelogHeader, validateFileSize } from "@/lib/file-helpers";
import { isMysqlId } from "@/lib/identifiers";
import { findOwnedMysqlProductIteration, hasMysqlProductIterationHistory, listMysqlProductIterations, listMysqlWorkRecords } from "@/lib/mysql-account-workspace";
import { deleteMysqlProjectFile, findOwnedMysqlProjectFile, MysqlFrozenDocumentError, MysqlIterationRequiredError, serializeMysqlProjectFile, updateMysqlProjectFile } from "@/lib/mysql-project-artifacts";
import { changeMysqlFileRevision } from "@/lib/mysql-file-revisions";
import { changeMysqlFileIdentity } from "@/lib/mysql-file-history";

function invalidFileResponse() {
  return NextResponse.json({ error: "fileId 参数无效" }, { status: 400 });
}

function invalidProjectResponse() {
  return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
}

async function mutationContextError(request: Request, projectId: string, userId: string) {
  const iterations = await listMysqlProductIterations(projectId, userId);
  if (!iterations) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
  if (iterations.length) {
    const iterationId = request.headers.get("x-current-iteration-id");
    const iteration = iterationId ? await findOwnedMysqlProductIteration(iterationId, userId) : null;
    return iteration?.project_id === projectId ? null : NextResponse.json({ error: "请先进入当前产品迭代，再修改项目文件" }, { status: 409 });
  }
  if (await hasMysqlProductIterationHistory(projectId, userId)) {
    return NextResponse.json({ error: "当前没有产品迭代，项目文件仅可浏览和下载" }, { status: 409 });
  }
  const legacyRecords = await listMysqlWorkRecords(projectId, userId);
  return legacyRecords?.length ? null : NextResponse.json({ error: "当前没有产品迭代，项目文件仅可浏览和下载" }, { status: 409 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id: projectId, fileId } = await params;
    if (!isMysqlId(projectId)) return invalidProjectResponse();
    if (!isMysqlId(fileId)) return invalidFileResponse();
    const file = await findOwnedMysqlProjectFile(projectId, fileId, userId);
    return file ? NextResponse.json({ ...serializeMysqlProjectFile(file), content: stripChangelogHeader(file.content), canUndo: file.previous_content !== null }) : NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
  } catch (error) { console.error("GET /api/projects/[id]/files/[fileId] error:", error); return NextResponse.json({ error: "获取文件失败" }, { status: 500 }); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id: projectId, fileId } = await params; const { content } = await request.json();
    if (!isMysqlId(projectId)) return invalidProjectResponse();
    if (!isMysqlId(fileId)) return invalidFileResponse();
    const contextError = await mutationContextError(request, projectId, userId); if (contextError) return contextError;
    const target = await findOwnedMysqlProjectFile(projectId, fileId, userId);
    if (target?.filename.startsWith("issues/")) return NextResponse.json({ error: "任务文件只能由所属迭代在项目文件树中修改" }, { status: 403 });
    if (typeof content !== "string") return NextResponse.json({ error: "文件内容不能为空" }, { status: 400 });
    const validation = validateFileSize(content); if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 413 });
    const iterationId = request.headers.get("x-current-iteration-id");
    if (iterationId) {
      const result = await changeMysqlFileRevision({ projectId, fileId, iterationId, userId, action: "edit", content });
      if (result.kind === "changed") {
        const updated = await findOwnedMysqlProjectFile(projectId, fileId, userId);
        return NextResponse.json(updated ? serializeMysqlProjectFile(updated) : { ...result, version: result.revision });
      }
      if (result.kind === "invalid-content") return NextResponse.json({ error: result.error }, { status: 413 });
      return NextResponse.json({ error: result.kind === "not-found" ? "文件不存在或无权访问" : "无法修改当前文件" }, { status: result.kind === "not-found" ? 404 : 409 });
    }
    const file = await updateMysqlProjectFile({ projectId, fileId, userId, content });
    return file ? NextResponse.json(serializeMysqlProjectFile(file)) : NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
  } catch (error) { if (error instanceof MysqlIterationRequiredError) return NextResponse.json({ error: error.message }, { status: 409 }); if (error instanceof MysqlFrozenDocumentError) return NextResponse.json({ error: FROZEN_DOCUMENT_LOCKED_MESSAGE }, { status: 409 }); console.error("PATCH /api/projects/[id]/files/[fileId] error:", error); return NextResponse.json({ error: "更新文件失败" }, { status: 500 }); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id: projectId, fileId } = await params;
    if (!isMysqlId(projectId)) return invalidProjectResponse();
    if (!isMysqlId(fileId)) return invalidFileResponse();
    const contextError = await mutationContextError(request, projectId, userId); if (contextError) return contextError;
    const target = await findOwnedMysqlProjectFile(projectId, fileId, userId);
    if (target?.filename.startsWith("issues/")) return NextResponse.json({ error: "任务文件只能由所属迭代在项目文件树中修改" }, { status: 403 });
    const iterationId = request.headers.get("x-current-iteration-id");
    if (iterationId) {
      const result = await changeMysqlFileIdentity({ projectId, fileId, iterationId, userId, action: "delete" });
      return result.kind === "changed" ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: result.kind === "not-found" ? "文件不存在或无权访问" : "无法删除当前文件" },
          { status: result.kind === "not-found" ? 404 : 409 });
    }
    const deleted = await deleteMysqlProjectFile(projectId, fileId, userId);
    return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
  } catch (error) { if (error instanceof MysqlIterationRequiredError) return NextResponse.json({ error: error.message }, { status: 409 }); if (error instanceof MysqlFrozenDocumentError) return NextResponse.json({ error: FROZEN_DOCUMENT_LOCKED_MESSAGE }, { status: 409 }); console.error("DELETE /api/projects/[id]/files/[fileId] error:", error); return NextResponse.json({ error: "删除文件失败" }, { status: 500 }); }
}
