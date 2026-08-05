import mongoose, { Document, Model } from "mongoose";

/**
 * Changelog entry embedded in the file content header.
 * Appended automatically when an Agent writes a file.
 */
export interface ChangelogEntry {
  requirement_count: number;
  iteration: number;
  last_editor: string; // agent_type or "user"
  timestamp: Date;
}

interface IProjectFile {
  filename: string;
  content: string;
  project_id: mongoose.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

export interface IProjectFileDocument extends IProjectFile, Document {
  _id: mongoose.Types.ObjectId;
}

const ProjectFileSchema = new mongoose.Schema<IProjectFileDocument>(
  {
    filename: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      default: "",
    },
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    created_at: {
      type: Date,
      default: () => new Date(),
    },
    updated_at: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    collection: "project_files",
  }
);

// Compound index: filename must be unique within a project
ProjectFileSchema.index({ project_id: 1, filename: 1 }, { unique: true });

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Format a changelog entry as a markdown comment block. */
export function formatChangelogHeader(entry: ChangelogEntry): string {
  return [
    "<!--",
    "changelog:",
    `  requirement_count: ${entry.requirement_count}`,
    `  iteration:        ${entry.iteration}`,
    `  last_editor:      ${entry.last_editor}`,
    `  timestamp:        ${entry.timestamp.toISOString()}`,
    "-->",
  ].join("\n");
}

/** Regex to match and extract the changelog header from file content. */
const CHANGELOG_PARSE_RE =
  /^<!--\nchangelog:\n\s{2}requirement_count:\s*(\d+)\n\s{2}iteration:\s*(\d+)\n\s{2}last_editor:\s*(.+)\n\s{2}timestamp:\s*(.+)\n-->\n?/;

/** Parse the changelog header from file content. Returns null if not found. */
export function parseChangelog(
  content: string
): { entry: ChangelogEntry; bodyContent: string } | null {
  const match = content.match(CHANGELOG_PARSE_RE);
  if (!match) return null;
  return {
    entry: {
      requirement_count: parseInt(match[1], 10),
      iteration: parseInt(match[2], 10),
      last_editor: match[3].trim(),
      timestamp: new Date(match[4].trim()),
    },
    bodyContent: content.slice(match[0].length),
  };
}

/**
 * Compute requirement count from file content body (excluding changelog header).
 * Counts top-level numbered sections only ("## N."), so template sub-sections
 * ("### 1.1 目标用户" style) are not miscounted as requirements.
 */
export function countRequirements(content: string): number {
  const matches = content.match(/^##\s+\d+[\.\、]/gm);
  return matches ? matches.length : 0;
}

const ProjectFile: Model<IProjectFileDocument> =
  mongoose.models.ProjectFile ??
  mongoose.model<IProjectFileDocument>("ProjectFile", ProjectFileSchema);

export default ProjectFile;
