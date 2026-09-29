import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { validateFileSize } from "@/lib/file-helpers";
import { getMysqlPool } from "@/lib/mysql";

type Folder = RowDataPacket & {
  id: string; project_id: string; owner_iteration_id: string; owner_iteration_number: number;
  owner_iteration_name: string; previous_snapshot: string | TaskIssue[] | null; owner_exists: number;
};
type TaskIssue = { id: string; filename: string; content: string; version: number; issue_number: number };
type IssueRow = RowDataPacket & TaskIssue;

const folderPath = (number: number) => `issues/iteration-${number}/`;
const issuePrefix = (number: number) => `${String(number).padStart(2, "0")}-`;

function validIssueFilename(filename: unknown, folder: Folder, issueNumber: number) {
  if (typeof filename !== "string" || filename.length > 700 || !filename.startsWith(folderPath(folder.owner_iteration_number) + issuePrefix(issueNumber)) || !filename.endsWith(".md")) return false;
  const suffix = filename.slice((folderPath(folder.owner_iteration_number) + issuePrefix(issueNumber)).length, -3);
  return suffix.length > 0 && suffix.length <= 180 && suffix === suffix.trim() && !/[\\/\u0000-\u001f]/u.test(suffix) && suffix !== "." && suffix !== "..";
}

function parseSnapshot(value: Folder["previous_snapshot"]): TaskIssue[] | null {
  if (value === null) return null;
  return typeof value === "string" ? JSON.parse(value) as TaskIssue[] : value;
}

export async function listMysqlTaskFolders(projectId: string, userId: string) {
  const [projects] = await getMysqlPool().query<RowDataPacket[]>("SELECT id FROM projects WHERE id = ? AND user_id = ?", [projectId, userId]);
  if (!projects.length) return null;
  const [folders] = await getMysqlPool().query<Folder[]>(
    `SELECT f.*, (i.id IS NOT NULL) AS owner_exists FROM task_folders f
     LEFT JOIN product_iterations i ON i.id = f.owner_iteration_id AND i.project_id = f.project_id
     WHERE f.project_id = ? ORDER BY f.owner_iteration_number`, [projectId]);
  return folders.map((folder) => ({
    id: folder.id, iterationNumber: Number(folder.owner_iteration_number),
    iterationName: folder.owner_iteration_name, ownerIterationId: folder.owner_exists ? folder.owner_iteration_id : null,
    archived: !folder.owner_exists, canUndo: folder.previous_snapshot !== null,
  }));
}

/** 文件夹身份只在所属迭代创建；编号由项目迭代的稳定编号决定。 */
export async function createMysqlTaskFolder(projectId: string, iterationId: string, userId: string) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [projects] = await connection.query<RowDataPacket[]>("SELECT id FROM projects WHERE id = ? AND user_id = ? FOR UPDATE", [projectId, userId]);
    if (!projects.length) { await connection.rollback(); return { kind: "not-found" as const }; }
    const [iterations] = await connection.query<Array<RowDataPacket & { iteration_number: number; display_name: string }>>(
      "SELECT iteration_number, display_name FROM product_iterations WHERE id = ? AND project_id = ? FOR UPDATE", [iterationId, projectId]);
    const iteration = iterations[0];
    if (!iteration) { await connection.rollback(); return { kind: "iteration-not-found" as const }; }
    const [existing] = await connection.query<Folder[]>("SELECT * FROM task_folders WHERE project_id = ? AND owner_iteration_id = ? FOR UPDATE", [projectId, iterationId]);
    if (existing.length) { await connection.rollback(); return { kind: "exists" as const, id: existing[0].id }; }
    const id = randomUUID();
    await connection.execute(
      "INSERT INTO task_folders (id, project_id, owner_iteration_id, owner_iteration_number, owner_iteration_name) VALUES (?, ?, ?, ?, ?)",
      [id, projectId, iterationId, iteration.iteration_number, iteration.display_name]);
    await connection.commit();
    return { kind: "created" as const, id };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

async function lockOwner(connection: PoolConnection, input: { projectId: string; iterationId: string; userId: string; folderId: string }) {
  const [projects] = await connection.query<RowDataPacket[]>("SELECT id FROM projects WHERE id = ? AND user_id = ? FOR UPDATE", [input.projectId, input.userId]);
  if (!projects.length) return { kind: "not-found" as const };
  const [iterations] = await connection.query<Array<RowDataPacket & { iteration_number: number; display_name: string }>>(
    "SELECT iteration_number, display_name FROM product_iterations WHERE id = ? AND project_id = ? FOR UPDATE", [input.iterationId, input.projectId]);
  const iteration = iterations[0];
  if (!iteration) return { kind: "iteration-not-found" as const };
  const [folders] = await connection.query<Folder[]>("SELECT * FROM task_folders WHERE id = ? AND project_id = ? FOR UPDATE", [input.folderId, input.projectId]);
  const folder = folders[0];
  if (!folder) return { kind: "folder-not-found" as const };
  if (folder.owner_iteration_id !== input.iterationId) return { kind: "read-only" as const };
  return { kind: "owner" as const, folder, iteration };
}

async function lockIssues(connection: PoolConnection, folderId: string) {
  const [rows] = await connection.query<IssueRow[]>(
    "SELECT id, filename, content, version, issue_number FROM project_files WHERE task_folder_id = ? ORDER BY issue_number FOR UPDATE", [folderId]);
  return rows.map((row) => ({ id: row.id, filename: row.filename, content: row.content, version: Number(row.version), issue_number: Number(row.issue_number) }));
}

async function recordChange(connection: PoolConnection, input: { projectId: string; folderId: string; fileId: string; groupId: string; action: string; filename: string; previousFilename?: string | null; revision?: number | null; iterationId: string; iterationNumber: number; iterationName: string; now: Date }) {
  await connection.execute(
    `INSERT INTO project_file_changes (id, project_id, file_id, task_change_group_id, task_folder_id, operation, filename,
      previous_filename, content_revision, actor, iteration_id, iteration_number, iteration_name, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, ?)`,
    [randomUUID(), input.projectId, input.fileId, input.groupId, input.folderId, input.action, input.filename,
      input.previousFilename ?? null, input.revision ?? null, input.iterationId,
      input.iterationNumber, input.iterationName, input.now]);
}

export async function findTaskFolderForFile(projectId: string, fileId: string) {
  const [rows] = await getMysqlPool().query<Array<RowDataPacket & { task_folder_id: string | null }>>(
    "SELECT task_folder_id FROM project_files WHERE id = ? AND project_id = ?", [fileId, projectId]);
  return rows[0]?.task_folder_id ?? null;
}

/** 单 issue 用户操作仍替换整个文件夹的唯一旧集合。 */
export async function changeMysqlTaskIssue(input: { projectId: string; iterationId: string; userId: string; folderId: string; fileId: string; action: "edit" | "rename" | "delete"; content?: string; filename?: string; forceFailure?: boolean }) {
  if (input.action === "edit") {
    const check = validateFileSize(input.content);
    if (!check.ok) return { kind: "invalid-content" as const, error: check.error };
  }
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const owner = await lockOwner(connection, input);
    if (owner.kind !== "owner") { await connection.rollback(); return owner; }
    const issues = await lockIssues(connection, input.folderId);
    const issue = issues.find((item) => item.id === input.fileId);
    if (!issue) { await connection.rollback(); return { kind: "not-found" as const }; }
    if (input.action === "rename" && !validIssueFilename(input.filename, owner.folder, issue.issue_number)) {
      await connection.rollback(); return { kind: "invalid-filename" as const };
    }
    if (input.action === "edit" && issue.content === input.content || input.action === "rename" && issue.filename === input.filename) {
      await connection.rollback(); return { kind: "unchanged" as const };
    }
    const groupId = randomUUID(); const now = new Date();
    await connection.execute("UPDATE task_folders SET previous_snapshot = ? WHERE id = ?", [JSON.stringify(issues), input.folderId]);
    let nextFilename = issue.filename; let nextContent = issue.content;
    if (input.action === "edit") {
      nextContent = input.content!;
      await connection.execute("UPDATE project_files SET content = ?, previous_content = NULL, version = version + 1, updated_at = ? WHERE id = ?", [nextContent, now, issue.id]);
    } else if (input.action === "rename") {
      nextFilename = input.filename!;
      await connection.execute("UPDATE project_files SET filename = ?, updated_at = ? WHERE id = ?", [nextFilename, now, issue.id]);
    } else {
      await connection.execute("DELETE FROM project_files WHERE id = ? AND project_id = ?", [issue.id, input.projectId]);
    }
    await recordChange(connection, { projectId: input.projectId, folderId: input.folderId, fileId: issue.id, groupId, action: input.action,
      filename: nextFilename, previousFilename: input.action === "rename" ? issue.filename : null,
      revision: input.action === "edit" ? issue.version + 1 : null, iterationId: input.iterationId,
      iterationNumber: owner.iteration.iteration_number, iterationName: owner.iteration.display_name, now });
    if (input.forceFailure) throw new Error("回放强制任务文件操作失败");
    await connection.commit();
    return { kind: "changed" as const, filename: nextFilename, content: nextContent, deleted: input.action === "delete", canUndo: true };
  } catch (error) {
    await connection.rollback();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return { kind: "duplicate" as const };
    throw error;
  } finally { connection.release(); }
}

export async function restoreMysqlTaskFolder(input: { projectId: string; iterationId: string; userId: string; folderId: string; forceFailure?: boolean }) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const owner = await lockOwner(connection, input);
    if (owner.kind !== "owner") { await connection.rollback(); return owner; }
    const previous = parseSnapshot(owner.folder.previous_snapshot);
    if (!previous) { await connection.rollback(); return { kind: "no-backup" as const }; }
    const current = await lockIssues(connection, input.folderId);
    const previousById = new Map(previous.map((issue) => [issue.id, issue]));
    const currentById = new Map(current.map((issue) => [issue.id, issue]));
    const groupId = randomUUID(); const now = new Date();
    // 路径冲突先移除本轮新增的 issue，再恢复旧集合的路径和正文。
    for (const issue of current) if (!previousById.has(issue.id)) {
      await connection.execute("DELETE FROM project_files WHERE id = ? AND project_id = ?", [issue.id, input.projectId]);
      await recordChange(connection, { projectId: input.projectId, folderId: input.folderId, fileId: issue.id, groupId, action: "delete", filename: issue.filename,
        iterationId: input.iterationId, iterationNumber: owner.iteration.iteration_number, iterationName: owner.iteration.display_name, now });
    }
    // 同一整套更新可能交换两个 issue 的描述；先让出旧路径，再按快照恢复。
    for (const target of previous) {
      const existing = currentById.get(target.id);
      if (existing && existing.filename !== target.filename) {
        await connection.execute("UPDATE project_files SET filename = ? WHERE id = ?", [`issues/.restore-${randomUUID()}.md`, target.id]);
      }
    }
    for (const target of previous) {
      const existing = currentById.get(target.id);
      if (!existing) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO project_files (id, project_id, filename, content, previous_content, version, task_folder_id, issue_number, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
          [target.id, input.projectId, target.filename, target.content, target.version + 1, input.folderId, target.issue_number, now, now]);
        await recordChange(connection, { projectId: input.projectId, folderId: input.folderId, fileId: target.id, groupId, action: "restore", filename: target.filename,
          revision: target.version + 1, iterationId: input.iterationId, iterationNumber: owner.iteration.iteration_number, iterationName: owner.iteration.display_name, now });
      } else {
        const contentChanged = existing.content !== target.content;
        const renamed = existing.filename !== target.filename;
        if (!contentChanged && !renamed) continue;
        const revision = existing.version + (contentChanged ? 1 : 0);
        await connection.execute("UPDATE project_files SET filename = ?, content = ?, previous_content = NULL, version = ?, updated_at = ? WHERE id = ?", [target.filename, target.content, revision, now, target.id]);
        await recordChange(connection, { projectId: input.projectId, folderId: input.folderId, fileId: target.id, groupId, action: contentChanged ? "restore" : "rename",
          filename: target.filename, previousFilename: renamed ? existing.filename : null,
          revision: contentChanged ? revision : null, iterationId: input.iterationId,
          iterationNumber: owner.iteration.iteration_number, iterationName: owner.iteration.display_name, now });
      }
    }
    await connection.execute("UPDATE task_folders SET previous_snapshot = NULL WHERE id = ?", [input.folderId]);
    if (input.forceFailure) throw new Error("回放强制任务撤回失败");
    await connection.commit();
    return { kind: "changed" as const };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
