import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { isConceptDocFile, isWorkingDocFile, validateFileSize } from "@/lib/file-helpers";
import { getMysqlPool } from "@/lib/mysql";

type FileRow = RowDataPacket & {
  id: string;
  filename: string;
  content: string;
  previous_content: string | null;
  version: number;
  freeze_binding_tab_id: string | null;
};

/** 编辑与撤回共用项目锁、文件锁和来源记录；失败时事务整体回滚。 */
export async function changeMysqlFileRevision(input: {
  projectId: string;
  iterationId: string;
  fileId: string;
  userId: string;
  action: "edit" | "restore";
  content?: string;
  forceFailure?: boolean;
}) {
  if (input.action === "edit") {
    const size = validateFileSize(input.content);
    if (!size.ok) return { kind: "invalid-content" as const, error: size.error };
  }
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [projects] = await connection.query<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM projects WHERE id = ? AND user_id = ? FOR UPDATE", [input.projectId, input.userId],
    );
    if (!projects.length) { await connection.rollback(); return { kind: "not-found" as const }; }
    const [iterations] = await connection.query<Array<RowDataPacket & { iteration_number: number; display_name: string }>>(
      "SELECT iteration_number, display_name FROM product_iterations WHERE id = ? AND project_id = ? FOR UPDATE",
      [input.iterationId, input.projectId],
    );
    const iteration = iterations[0];
    if (!iteration) { await connection.rollback(); return { kind: "iteration-not-found" as const }; }
    const [rows] = await connection.query<FileRow[]>(
      `SELECT id, filename, content, previous_content, version, freeze_binding_tab_id
       FROM project_files WHERE id = ? AND project_id = ? FOR UPDATE`, [input.fileId, input.projectId],
    );
    const file = rows[0];
    if (!file) { await connection.rollback(); return { kind: "not-found" as const }; }
    if (file.filename.startsWith("issues/") || isConceptDocFile(file.filename) || isWorkingDocFile(file.filename)) {
      await connection.rollback(); return { kind: "unsupported-file" as const };
    }
    if (file.freeze_binding_tab_id) { await connection.rollback(); return { kind: "locked" as const }; }
    if (input.action === "restore" && file.previous_content === null) {
      await connection.rollback(); return { kind: "no-backup" as const };
    }
    const nextContent = input.action === "restore" ? file.previous_content! : input.content!;
    if (input.action === "edit" && nextContent === file.content) {
      await connection.rollback(); return { kind: "unchanged" as const };
    }
    const revision = Number(file.version) + 1;
    const now = new Date();
    await connection.execute<ResultSetHeader>(
      `UPDATE project_files SET content = ?, previous_content = ?, version = ?, updated_at = ? WHERE id = ?`,
      [nextContent, input.action === "restore" ? null : file.content, revision, now, file.id],
    );
    await connection.execute<ResultSetHeader>(
      `INSERT INTO project_file_changes
       (id, project_id, file_id, operation, filename, content_revision, actor, iteration_id,
        iteration_number, iteration_name, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, ?)`,
      [randomUUID(), input.projectId, file.id, input.action, file.filename, revision,
        input.iterationId, iteration.iteration_number, iteration.display_name, now],
    );
    if (input.forceFailure) throw new Error("回放强制文件修订失败");
    await connection.commit();
    return { kind: "changed" as const, content: nextContent, revision,
      canUndo: input.action === "edit", filename: file.filename };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
