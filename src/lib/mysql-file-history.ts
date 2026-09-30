import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { isConceptDocFile, isWorkingDocFile } from "@/lib/file-helpers";
import { validCandidateFilename } from "@/lib/markdown-candidate-filename";
import { getMysqlPool } from "@/lib/mysql";
import { getWorkbenchFileStage } from "@/lib/workbench-file-branch";

type ChangeRow = RowDataPacket & {
  id: string; file_id: string; operation: string; filename: string; previous_filename: string | null;
  content_revision: number | null; actor: "agent" | "user"; iteration_id: string | null;
  iteration_number: number; iteration_name: string; stage: string | null;
  session_name: string | null; occurred_at: Date; iteration_exists: number; session_deleted: number;
};

/** 来源只读写入时的快照；对象删除后仍能解释当时的操作。 */
function serializeChange(row: ChangeRow) {
  return {
    id: row.id, fileId: row.file_id, operation: row.operation,
    filename: row.filename, previousFilename: row.previous_filename,
    actor: row.actor, iterationId: row.iteration_exists ? row.iteration_id : null,
    iterationNumber: Number(row.iteration_number), iterationName: row.iteration_name,
    iterationDeleted: !row.iteration_exists, stage: row.stage, sessionName: row.session_name,
    sessionDeleted: Boolean(row.session_deleted),
    occurredAt: row.occurred_at,
  };
}

const CHANGE_COLUMNS = `c.id, c.file_id, c.operation, c.filename, c.previous_filename,
  c.content_revision, c.actor, c.iteration_id, c.iteration_number, c.iteration_name,
  c.stage, c.session_name, c.occurred_at, c.change_sequence, (i.id IS NOT NULL) AS iteration_exists,
  (c.session_id IS NOT NULL AND s.id IS NULL) AS session_deleted`;

export async function getMysqlFileHistory(projectId: string, fileId: string, userId: string) {
  const [projects] = await getMysqlPool().query<RowDataPacket[]>(
    "SELECT id FROM projects WHERE id = ? AND user_id = ?", [projectId, userId]);
  if (!projects.length) return null;
  const [files] = await getMysqlPool().query<Array<RowDataPacket & { id: string; filename: string; previous_content: string | null; task_folder_id: string | null; task_can_undo: number }>>(
    `SELECT f.id, f.filename, f.previous_content, f.task_folder_id,
      (tf.previous_snapshot IS NOT NULL) AS task_can_undo
     FROM project_files f LEFT JOIN task_folders tf ON tf.id = f.task_folder_id
     WHERE f.id = ? AND f.project_id = ?`, [fileId, projectId]);
  const [rows] = await getMysqlPool().query<ChangeRow[]>(
    `SELECT ${CHANGE_COLUMNS} FROM project_file_changes c
     LEFT JOIN product_iterations i ON i.id = c.iteration_id
     LEFT JOIN iteration_sessions s ON s.id = c.session_id
     WHERE c.project_id = ? AND c.file_id = ? ORDER BY c.occurred_at ASC, c.change_sequence ASC`, [projectId, fileId]);
  const file = files[0];
  if (!file && (!rows.length || rows.at(-1)?.operation !== "delete")) return null;
  const creation = rows.find((row) => row.operation === "create") ?? null;
  const contentChanges = rows.filter((row) => row.content_revision !== null);
  return {
    id: fileId, filename: file?.filename ?? rows.at(-1)!.filename, deleted: !file,
    canUndo: file ? file.task_folder_id ? Boolean(file.task_can_undo) : file.previous_content !== null : false,
    createdAt: creation?.occurred_at ?? null,
    createdBy: creation ? serializeChange(creation) : null,
    lastContentChange: contentChanges.length ? serializeChange(contentChanges.at(-1)!) : null,
    changes: rows.map(serializeChange),
  };
}

export async function listMysqlIterationWrites(iterationId: string, userId: string) {
  const [iterations] = await getMysqlPool().query<Array<RowDataPacket & { project_id: string }>>(
    `SELECT i.project_id FROM product_iterations i JOIN projects p ON p.id = i.project_id
     WHERE i.id = ? AND p.user_id = ?`, [iterationId, userId]);
  if (!iterations.length) return null;
  const [rows] = await getMysqlPool().query<ChangeRow[]>(
    `SELECT ${CHANGE_COLUMNS} FROM project_file_changes c
     LEFT JOIN product_iterations i ON i.id = c.iteration_id
     LEFT JOIN iteration_sessions s ON s.id = c.session_id
     WHERE c.project_id = ? AND c.iteration_id = ? ORDER BY c.occurred_at DESC, c.change_sequence DESC`,
    [iterations[0].project_id, iterationId]);
  const files = new Map<string, { fileId: string; filename: string; deleted: boolean; changes: ReturnType<typeof serializeChange>[] }>();
  for (const row of rows) {
    const entry = files.get(row.file_id);
    if (entry) entry.changes.push(serializeChange(row));
    else files.set(row.file_id, { fileId: row.file_id, filename: row.filename,
      deleted: row.operation === "delete", changes: [serializeChange(row)] });
  }
  return [...files.values()];
}

export async function changeMysqlFileIdentity(input: {
  projectId: string; iterationId: string; fileId: string; userId: string;
  action: "rename" | "delete"; filename?: string; forceFailure?: boolean;
}) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [projects] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM projects WHERE id = ? AND user_id = ? FOR UPDATE", [input.projectId, input.userId]);
    if (!projects.length) { await connection.rollback(); return { kind: "not-found" as const }; }
    const [iterations] = await connection.query<Array<RowDataPacket & { iteration_number: number; display_name: string }>>(
      "SELECT iteration_number, display_name FROM product_iterations WHERE id = ? AND project_id = ? FOR UPDATE",
      [input.iterationId, input.projectId]);
    const iteration = iterations[0];
    if (!iteration) { await connection.rollback(); return { kind: "iteration-not-found" as const }; }
    const [files] = await connection.query<Array<RowDataPacket & { filename: string; freeze_binding_tab_id: string | null }>>(
      "SELECT filename, freeze_binding_tab_id FROM project_files WHERE id = ? AND project_id = ? FOR UPDATE",
      [input.fileId, input.projectId]);
    const file = files[0];
    if (!file) { await connection.rollback(); return { kind: "not-found" as const }; }
    if (file.filename.startsWith("issues/") || isConceptDocFile(file.filename) || isWorkingDocFile(file.filename)) {
      await connection.rollback(); return { kind: "unsupported-file" as const };
    }
    if (file.freeze_binding_tab_id) { await connection.rollback(); return { kind: "locked" as const }; }
    if (input.action === "rename") {
      const stage = getWorkbenchFileStage(file.filename);
      if (stage === "tickets" || !validCandidateFilename(input.filename, stage)) {
        await connection.rollback(); return { kind: "invalid-filename" as const };
      }
      if (input.filename === file.filename) { await connection.rollback(); return { kind: "unchanged" as const }; }
      const [existing] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM project_files WHERE project_id = ? AND BINARY filename = BINARY ? LIMIT 1",
        [input.projectId, input.filename]);
      if (existing.length) { await connection.rollback(); return { kind: "duplicate" as const }; }
    }
    const now = new Date();
    const nextFilename = input.action === "rename" ? input.filename! : file.filename;
    await connection.execute<ResultSetHeader>(
      `INSERT INTO project_file_changes
       (id, project_id, file_id, operation, filename, previous_filename, content_revision, actor,
        iteration_id, iteration_number, iteration_name, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'user', ?, ?, ?, ?)`,
      [randomUUID(), input.projectId, input.fileId, input.action, nextFilename,
        input.action === "rename" ? file.filename : null, input.iterationId,
        iteration.iteration_number, iteration.display_name, now]);
    if (input.action === "rename") {
      await connection.execute<ResultSetHeader>(
        "UPDATE project_files SET filename = ?, updated_at = ? WHERE id = ?",
        [nextFilename, now, input.fileId]);
    } else {
      await connection.execute<ResultSetHeader>(
        "DELETE FROM project_files WHERE id = ? AND project_id = ?", [input.fileId, input.projectId]);
    }
    if (input.forceFailure) throw new Error("回放强制文件身份操作失败");
    await connection.commit();
    return { kind: "changed" as const, filename: nextFilename, deleted: input.action === "delete" };
  } catch (error) {
    await connection.rollback();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return { kind: "duplicate" as const };
    throw error;
  } finally { connection.release(); }
}
