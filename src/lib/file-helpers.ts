import mongoose from "mongoose";
import AgentFileContext from "@/models/AgentFileContext";
import type { IProjectFileDocument } from "@/models/ProjectFile";

export interface ProjectFileData {
  id: string;
  filename: string;
  content: string;
  project_id: string;
  created_at: Date;
  updated_at: Date;
}

/** Serialize a ProjectFile document to a plain object for API responses. */
export function serializeProjectFile(
  file: IProjectFileDocument
): ProjectFileData {
  return {
    id: file._id.toString(),
    filename: file.filename,
    content: file.content,
    project_id: file.project_id.toString(),
    created_at: file.created_at,
    updated_at: file.updated_at,
  };
}

// ─── Shared changelog utilities ───────────────────────────────────────────────

/** Regex matching the changelog markdown comment block at the start of a file. */
export const CHANGELOG_HEADER_RE =
  /^<!--\nchangelog:\n[\s\S]*?-->\n?/;

/** Strip the changelog header from file content for display. */
export function stripChangelogHeader(content: string): string {
  return content.replace(CHANGELOG_HEADER_RE, "").trimStart();
}

// ─── Context file helpers ──────────────────────────────────────────────────────

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
 * Used by chat route (needs content) and context files API route.
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
    if (file && file.filename) {
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
