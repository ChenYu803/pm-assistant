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
  if (!content) return "";
  return content.replace(CHANGELOG_HEADER_RE, "").trimStart();
}

