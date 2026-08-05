import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import AgentFileContext from "@/models/AgentFileContext";
import ProjectFile from "@/models/ProjectFile";
import { findOwnedTab, findOwnedProjectFile } from "@/lib/ownership";

/** List files loaded in a tab's agent context. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: tabId } = await params;

    await dbConnect();

    const tab = await findOwnedTab(tabId, userId);
    if (!tab) {
      return NextResponse.json(
        { error: "标签页不存在或无权访问" },
        { status: 404 }
      );
    }

    const entries = await AgentFileContext.find({ tab_id: tab._id })
      .populate("file_id")
      .lean();

    const files = [];
    for (const entry of entries) {
      // Populated field may be an ObjectId or a full document
      const file = entry.file_id as unknown as {
        _id: { toString(): string };
        filename?: string;
        content?: string;
        project_id?: { toString(): string };
        created_at?: Date;
        updated_at?: Date;
      } | null;
      if (file && file.filename) {
        files.push({
          id: file._id.toString(),
          filename: file.filename,
          project_id: file.project_id?.toString(),
          created_at: file.created_at,
          updated_at: file.updated_at,
        });
      }
    }

    return NextResponse.json({ files });
  } catch (error) {
    console.error("GET /api/tabs/[id]/files error:", error);
    return NextResponse.json(
      { error: "获取上下文文件失败" },
      { status: 500 }
    );
  }
}

/** Load a file into a tab's agent context. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: tabId } = await params;

    const body = await request.json();
    const { file_id } = body as { file_id: string };

    if (!file_id || typeof file_id !== "string") {
      return NextResponse.json(
        { error: "file_id 不能为空" },
        { status: 400 }
      );
    }

    await dbConnect();

    const tab = await findOwnedTab(tabId, userId);
    if (!tab) {
      return NextResponse.json(
        { error: "标签页不存在或无权访问" },
        { status: 404 }
      );
    }

    // Verify file exists and user owns it
    const file = await findOwnedProjectFile(file_id, userId);
    if (!file) {
      return NextResponse.json(
        { error: "文件不存在或无权访问" },
        { status: 404 }
      );
    }

    try {
      const entry = await AgentFileContext.create({
        tab_id: tab._id,
        file_id: file._id,
      });
      return NextResponse.json(
        {
          id: entry._id.toString(),
          file_id: file_id,
          filename: file.filename,
        },
        { status: 201 }
      );
    } catch (err) {
      // Duplicate key — file already loaded
      if ((err as { code?: number }).code === 11000) {
        return NextResponse.json(
          { error: "文件已在上下文中" },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (error) {
    console.error("POST /api/tabs/[id]/files error:", error);
    return NextResponse.json(
      { error: "加载文件到上下文失败" },
      { status: 500 }
    );
  }
}
