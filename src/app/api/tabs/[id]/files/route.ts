import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import AgentFileContext from "@/models/AgentFileContext";
import {
  findOwnedTabWithProject,
  findOwnedProjectFileInProject,
  parseObjectId,
} from "@/lib/ownership";
import { getLoadedContextFiles } from "@/lib/context-files";
import { isConceptDocFile, isWorkingDocFile } from "@/lib/file-helpers";
import { acquireTabWriteLease } from "@/lib/deletion-coordination";
import { isMysqlId } from "@/lib/identifiers";
import { addMysqlContextFile, listMysqlLoadedContextFiles } from "@/lib/mysql-project-artifacts";
import { findOwnedMysqlConversationTab } from "@/lib/mysql-conversation";

/** List files loaded in a tab's agent context. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: tabId } = await params;

    if (isMysqlId(tabId)) {
      const tab = await findOwnedMysqlConversationTab(tabId, userId);
      if (!tab) return NextResponse.json({ error: "标签页不存在或无权访问" }, { status: 404 });
      const loadedFiles = await listMysqlLoadedContextFiles(tabId, tab.project_id);
      return NextResponse.json({ files: loadedFiles.map((file) => ({ id: file._id, filename: file.filename, project_id: file.project_id, created_at: file.created_at, updated_at: file.updated_at })) });
    }

    await dbConnect();

    const ownedTab = await findOwnedTabWithProject(tabId, userId);
    if (!ownedTab) {
      return NextResponse.json(
        { error: "标签页不存在或无权访问" },
        { status: 404 }
      );
    }
    const { tab, project } = ownedTab;

    const loadedFiles = await getLoadedContextFiles(tab._id, project._id);

    // Omit content from list endpoint (consistent with GET /api/projects/:id/files)
    const files = loadedFiles.map((file) => ({
      id: file._id,
      filename: file.filename,
      project_id: file.project_id,
      created_at: file.created_at,
      updated_at: file.updated_at,
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

    if (isMysqlId(tabId)) {
      if (!isMysqlId(file_id)) return NextResponse.json({ error: "fileId 参数无效" }, { status: 400 });
      const result = await addMysqlContextFile(tabId, file_id, userId);
      if (result.kind === "tab-not-found") return NextResponse.json({ error: "标签页不存在或无权访问" }, { status: 404 });
      if (result.kind === "file-not-found") return NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
      if (result.kind === "not-loadable") return NextResponse.json({ error: "工作文档/概念版为中间过程产物，不可加载进 Agent 上下文" }, { status: 400 });
      if (result.kind === "duplicate") return NextResponse.json({ error: "文件已在上下文中" }, { status: 409 });
      return NextResponse.json({ id: `${tabId}:${file_id}`, file_id, filename: result.file.filename }, { status: 201 });
    }

    await dbConnect();

    const writeLease = await acquireTabWriteLease(tabId, userId);
    if (!writeLease) {
      return NextResponse.json(
        { error: "标签页不存在或无权访问" },
        { status: 404 }
      );
    }
    const { tab, project } = writeLease;

    try {
      if (!parseObjectId(file_id)) {
        return NextResponse.json(
          { error: "fileId 参数无效" },
          { status: 400 }
        );
      }

      // Verify file exists, belongs to the current project, and is owned by the user.
      const file = await findOwnedProjectFileInProject(
        project._id.toString(),
        file_id,
        userId
      );
      if (!file) {
        return NextResponse.json(
          { error: "文件不存在或无权访问" },
          { status: 404 }
        );
      }

      // 工作文档 / 概念版是中间过程产物，不可加载进任何 Agent 的上下文
      // （03 mini 会决策工作文档；05 mini 会决策概念版——AI 侧单源不破）
      if (isWorkingDocFile(file.filename) || isConceptDocFile(file.filename)) {
        return NextResponse.json(
          { error: "工作文档/概念版为中间过程产物，不可加载进 Agent 上下文" },
          { status: 400 }
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
    } finally {
      await writeLease.release();
    }
  } catch (error) {
    console.error("POST /api/tabs/[id]/files error:", error);
    return NextResponse.json(
      { error: "加载文件到上下文失败" },
      { status: 500 }
    );
  }
}
