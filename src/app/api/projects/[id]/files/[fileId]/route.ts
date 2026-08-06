import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import AgentFileContext from "@/models/AgentFileContext";
import { findOwnedProjectFile } from "@/lib/ownership";
import { serializeProjectFile } from "@/lib/file-helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { fileId } = await params;

    await dbConnect();

    const file = await findOwnedProjectFile(fileId, userId);
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

    const { fileId } = await params;

    const body = await request.json();
    const { content } = body as { content: string };

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "文件内容不能为空" },
        { status: 400 }
      );
    }

    await dbConnect();

    const file = await findOwnedProjectFile(fileId, userId);
    if (!file) {
      return NextResponse.json(
        { error: "文件不存在或无权访问" },
        { status: 404 }
      );
    }

    // User edit: update content as-is, do NOT modify changelog
    file.content = content;
    file.updated_at = new Date();
    await file.save();

    return NextResponse.json(serializeProjectFile(file));
  } catch (error) {
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

    const { fileId } = await params;

    await dbConnect();

    const file = await findOwnedProjectFile(fileId, userId);
    if (!file) {
      return NextResponse.json(
        { error: "文件不存在或无权访问" },
        { status: 404 }
      );
    }

    await file.deleteOne();
    // 清理 Agent 上下文中对该文件的引用
    await AgentFileContext.deleteMany({ file_id: file._id });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/projects/[id]/files/[fileId] error:", error);
    return NextResponse.json(
      { error: "删除文件失败" },
      { status: 500 }
    );
  }
}
