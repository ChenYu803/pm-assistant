import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import AgentFileContext from "@/models/AgentFileContext";
import ProjectFile from "@/models/ProjectFile";
import {
  findOwnedProjectFileInProject,
  parseObjectId,
} from "@/lib/ownership";
import { serializeProjectFile } from "@/lib/file-helpers";
import { validateFileSize } from "@/lib/file-helpers";
import {
  FROZEN_DOCUMENT_LOCKED_MESSAGE,
  mutableProjectFileFilter,
} from "@/lib/freeze-document-binding";
import { acquireProjectWriteLease } from "@/lib/deletion-coordination";
import { isMysqlId } from "@/lib/identifiers";
import { deleteMysqlProjectFile, findOwnedMysqlProjectFile, MysqlFrozenDocumentError, serializeMysqlProjectFile, updateMysqlProjectFile } from "@/lib/mysql-project-artifacts";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: projectId, fileId } = await params;

    if (isMysqlId(projectId)) {
      if (!isMysqlId(fileId)) return NextResponse.json({ error: "fileId 参数无效" }, { status: 400 });
      const file = await findOwnedMysqlProjectFile(projectId, fileId, userId);
      if (!file) return NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
      return NextResponse.json(serializeMysqlProjectFile(file));
    }

    if (!parseObjectId(fileId)) {
      return NextResponse.json({ error: "fileId 参数无效" }, { status: 400 });
    }

    await dbConnect();

    const file = await findOwnedProjectFileInProject(projectId, fileId, userId);
    if (!file) {
      return NextResponse.json(
        { error: "文件不存在或无权访问" },
        { status: 404 }
      );
    }

    return NextResponse.json(serializeProjectFile(file));
  } catch (error) {
    console.error("GET /api/projects/[id]/files/[fileId] error:", error);
    return NextResponse.json(
      { error: "获取文件失败" },
      { status: 500 }
    );
  }
}

/** User manually edits a file. Does NOT update the changelog. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: projectId, fileId } = await params;

    const body = await request.json();
    const { content } = body as { content: string };

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "文件内容不能为空" },
        { status: 400 }
      );
    }
    const contentValidation = validateFileSize(content);
    if (!contentValidation.ok) {
      return NextResponse.json({ error: contentValidation.error }, { status: 413 });
    }

    if (isMysqlId(projectId)) {
      if (!isMysqlId(fileId)) return NextResponse.json({ error: "fileId 参数无效" }, { status: 400 });
      const updated = await updateMysqlProjectFile({ projectId, fileId, userId, content });
      if (!updated) return NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
      return NextResponse.json(serializeMysqlProjectFile(updated));
    }

    if (!parseObjectId(fileId)) {
      return NextResponse.json({ error: "fileId 参数无效" }, { status: 400 });
    }

    await dbConnect();

    const writeLease = await acquireProjectWriteLease(projectId, userId);
    if (!writeLease) {
      return NextResponse.json(
        { error: "文件不存在或无权访问" },
        { status: 404 }
      );
    }
    try {
      const file = await findOwnedProjectFileInProject(projectId, fileId, userId);
      if (!file) {
        return NextResponse.json(
          { error: "文件不存在或无权访问" },
          { status: 404 }
        );
      }

      // User edit: update content as-is, do NOT modify changelog.
      const updatedAt = new Date();
      const updated = await ProjectFile.findOneAndUpdate(
        mutableProjectFileFilter(file._id),
        {
          $set: { content, updated_at: updatedAt },
          $inc: { version: 1 },
        },
        { returnDocument: "after" }
      );
      if (!updated) {
        return NextResponse.json(
          { error: FROZEN_DOCUMENT_LOCKED_MESSAGE },
          { status: 409 }
        );
      }

      return NextResponse.json(serializeProjectFile(updated));
    } finally {
      await writeLease.release();
    }
  } catch (error) {
    if (error instanceof MysqlFrozenDocumentError) {
      return NextResponse.json({ error: FROZEN_DOCUMENT_LOCKED_MESSAGE }, { status: 409 });
    }
    console.error("PATCH /api/projects/[id]/files/[fileId] error:", error);
    return NextResponse.json(
      { error: "更新文件失败" },
      { status: 500 }
    );
  }
}

/**
 * 删除文件。不可恢复；同时清理所有标签页对该文件的上下文引用
 * （agent_file_contexts），避免失效引用。
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: projectId, fileId } = await params;

    if (isMysqlId(projectId)) {
      if (!isMysqlId(fileId)) return NextResponse.json({ error: "fileId 参数无效" }, { status: 400 });
      const deleted = await deleteMysqlProjectFile(projectId, fileId, userId);
      if (!deleted) return NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (!parseObjectId(fileId)) {
      return NextResponse.json({ error: "fileId 参数无效" }, { status: 400 });
    }

    await dbConnect();

    const writeLease = await acquireProjectWriteLease(projectId, userId);
    if (!writeLease) {
      return NextResponse.json(
        { error: "文件不存在或无权访问" },
        { status: 404 }
      );
    }
    try {
      const file = await findOwnedProjectFileInProject(projectId, fileId, userId);
      if (!file) {
        return NextResponse.json(
          { error: "文件不存在或无权访问" },
          { status: 404 }
        );
      }

      const deleteResult = await file.collection.deleteOne(
        mutableProjectFileFilter(file._id)
      );
      if (deleteResult.deletedCount !== 1) {
        return NextResponse.json(
          { error: FROZEN_DOCUMENT_LOCKED_MESSAGE },
          { status: 409 }
        );
      }
      // 清理 Agent 上下文中对该文件的引用
      await AgentFileContext.deleteMany({ file_id: file._id });

      return NextResponse.json({ ok: true });
    } finally {
      await writeLease.release();
    }
  } catch (error) {
    if (error instanceof MysqlFrozenDocumentError) {
      return NextResponse.json({ error: FROZEN_DOCUMENT_LOCKED_MESSAGE }, { status: 409 });
    }
    console.error("DELETE /api/projects/[id]/files/[fileId] error:", error);
    return NextResponse.json(
      { error: "删除文件失败" },
      { status: 500 }
    );
  }
}
