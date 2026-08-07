import mongoose from "mongoose";
import AgentFileContext from "@/models/AgentFileContext";
import type { IProjectFileDocument } from "@/models/ProjectFile";
import { isWorkingDocFile } from "@/lib/file-helpers";

/** Lightweight file info returned by getLoadedContextFiles. */
export interface LoadedFileInfo {
  _id: string;
  filename: string;
  content: string;
  project_id: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Fetch all ProjectFile documents loaded in a tab's agent context.
 * Handles Mongoose populate + lean cast so callers get plain objects.
 * SERVER-ONLY — uses Mongoose, do not import from client components.
 */
export async function getLoadedContextFiles(
  tabId: mongoose.Types.ObjectId
): Promise<LoadedFileInfo[]> {
  const entries = await AgentFileContext.find({ tab_id: tabId })
    .populate<{ file_id: IProjectFileDocument }>("file_id")
    .lean();

  const files: LoadedFileInfo[] = [];
  for (const entry of entries) {
    const file = entry.file_id as unknown as IProjectFileDocument | null;
    // 工作文档不可加载进 Agent 上下文——即使历史残留了加载记录也过滤掉
    if (file && file.filename && !isWorkingDocFile(file.filename)) {
      files.push({
        _id: file._id.toString(),
        filename: file.filename,
        content: file.content,
        project_id: file.project_id.toString(),
        created_at: file.created_at,
        updated_at: file.updated_at,
      });
    }
  }
  return files;
}
