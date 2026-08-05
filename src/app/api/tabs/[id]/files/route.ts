import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import AgentFileContext from "@/models/AgentFileContext";
import { findOwnedTab, findOwnedProjectFile } from "@/lib/ownership";
import { getLoadedContextFiles } from "@/lib/file-helpers";

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

    const loadedFiles = await getLoadedContextFiles(tab._id);

    // Omit content from list endpoint (consistent with GET /api/projects/:id/files)
    const files = loadedFiles.map(({ content: _, ...rest }) => ({
      id: rest._id,
      filename: rest.filename,
      project_id: rest.project_id,
      created_at: rest.created_at,
      updated_at: rest.updated_at,
    }));

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
