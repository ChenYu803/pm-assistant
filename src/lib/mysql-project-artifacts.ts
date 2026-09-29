import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { AgentType } from "@/lib/agent-constants";
import { getMysqlPool } from "@/lib/mysql";
import { findOwnedMysqlProject, type MysqlProject } from "@/lib/mysql-account-workspace";
import { isConceptDocFile, isWorkingDocFile, validateFileSize } from "@/lib/file-helpers";
import { formatChangelogHeader } from "@/lib/file-helpers";

export interface MysqlProjectFile extends RowDataPacket {
  id: string;
  project_id: string;
  filename: string;
  content: string;
  previous_content?: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  freeze_binding_tab_id?: string | null;
  freeze_binding_document_digest?: string | null;
  freeze_binding_locked_at?: Date | null;
}

export interface MysqlPrototypeSnapshot extends RowDataPacket {
  id: string;
  project_id: string;
  tab_id: string | null;
  content: string;
  version: number;
  created_at: Date;
}

export interface MysqlMessageFileWrite extends RowDataPacket {
  id: string;
  message_id: string;
  filename: string;
  operation: "create" | "update";
  file_version: number;
  message_status: "completed";
  write_status: "written";
  written_at: Date;
}

export interface MysqlLoadedFile {
  _id: string;
  filename: string;
  content: string;
  project_id: string;
  created_at: Date;
  updated_at: Date;
}

const PROJECT_FILE_COLUMNS = "id, project_id, filename, content, version, created_at, updated_at, freeze_binding_tab_id, freeze_binding_document_digest, freeze_binding_locked_at";

export class MysqlFrozenDocumentError extends Error {
  constructor() {
    super("冻结文档已正式锁定，不能修改");
  }
}

export class MysqlFileTooLargeError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function assertMysqlFileSize(content: string) {
  const validation = validateFileSize(content);
  if (!validation.ok) throw new MysqlFileTooLargeError(validation.error);
}

export async function listMysqlProjectFiles(projectId: string, userId: string) {
  if (!(await findOwnedMysqlProject(projectId, userId))) return null;
  const [rows] = await getMysqlPool().query<MysqlProjectFile[]>(
    `SELECT ${PROJECT_FILE_COLUMNS} FROM project_files WHERE project_id = ? ORDER BY updated_at DESC, id DESC`,
    [projectId]
  );
  return rows;
}

export async function listMysqlProjectFileDirectory(projectId: string, userId: string) {
  if (!(await findOwnedMysqlProject(projectId, userId))) return null;
  const [rows] = await getMysqlPool().query<Array<RowDataPacket & {
    id: string; project_id: string; filename: string; version: number; created_at: Date; updated_at: Date;
    lastContentIteration: string | null; canUndo: number;
  }>>(
    `SELECT f.id, f.project_id, f.filename, f.version, f.created_at, f.updated_at,
            IF(c.id IS NULL, NULL, CONCAT('迭代 ', LPAD(c.iteration_number, 2, '0'), IF(i.id IS NULL, '（已删除）', ''))) AS lastContentIteration,
            (f.previous_content IS NOT NULL) AS canUndo
     FROM project_files f
     LEFT JOIN project_file_changes c ON c.id = (
       SELECT latest.id FROM project_file_changes latest WHERE latest.file_id = f.id AND latest.content_revision IS NOT NULL
       ORDER BY latest.occurred_at DESC, latest.change_sequence DESC LIMIT 1
     )
     LEFT JOIN product_iterations i ON i.id = c.iteration_id
     WHERE f.project_id = ? ORDER BY f.updated_at DESC, f.id DESC`,
    [projectId],
  );
  const [deleted] = await getMysqlPool().query<Array<RowDataPacket & { id: string; filename: string; updated_at: Date }>>(
    `SELECT c.file_id AS id, c.filename, c.occurred_at AS updated_at
     FROM project_file_changes c
     WHERE c.project_id = ? AND c.operation = 'delete'
       AND NOT EXISTS (SELECT 1 FROM project_files f WHERE f.id = c.file_id)
       AND c.id = (SELECT latest.id FROM project_file_changes latest WHERE latest.file_id = c.file_id
                   ORDER BY latest.occurred_at DESC, latest.change_sequence DESC LIMIT 1)
     ORDER BY c.occurred_at DESC, c.change_sequence DESC`, [projectId]);
  return [...rows.map((row) => ({ ...row, deleted: false })),
    ...deleted.map((row) => ({ ...row, project_id: projectId, version: 0, created_at: row.updated_at,
      lastContentIteration: null, canUndo: 0, deleted: true }))];
}

export async function findOwnedMysqlProjectFile(projectId: string, fileId: string, userId: string) {
  if (!(await findOwnedMysqlProject(projectId, userId))) return null;
  const [rows] = await getMysqlPool().query<MysqlProjectFile[]>(
    `SELECT ${PROJECT_FILE_COLUMNS}, previous_content FROM project_files WHERE id = ? AND project_id = ? LIMIT 1`,
    [fileId, projectId]
  );
  return rows[0] ?? null;
}

export async function findMysqlProjectFileByFilename(projectId: string, filename: string) {
  const [rows] = await getMysqlPool().query<MysqlProjectFile[]>(
    `SELECT ${PROJECT_FILE_COLUMNS} FROM project_files WHERE project_id = ? AND filename = ? LIMIT 1`,
    [projectId, filename]
  );
  return rows[0] ?? null;
}

async function findSourceMessage(connection: PoolConnection, input: { projectId: string; sourceMessageId: string; agentType: AgentType }) {
  const [rows] = await connection.query<Array<RowDataPacket & { id: string; tab_id: string }>>(
    `SELECT m.id, m.tab_id
     FROM messages m
     JOIN tabs t ON t.id = m.tab_id
     JOIN work_records w ON w.id = t.work_record_id
     WHERE m.id = ? AND m.role = 'assistant' AND m.status = 'completed'
       AND t.agent_type = ? AND w.project_id = ? LIMIT 1 FOR UPDATE`,
    [input.sourceMessageId, input.agentType, input.projectId]
  );
  return rows[0] ?? null;
}

export function serializeMysqlProjectFile(file: MysqlProjectFile) {
  return {
    id: file.id,
    filename: file.filename,
    content: file.content,
    project_id: file.project_id,
    version: Number(file.version),
    created_at: file.created_at,
    updated_at: file.updated_at,
  };
}

export async function writeMysqlProjectFile(input: {
  projectId: string;
  userId: string;
  filename: string;
  content: string;
  buildContent?: (existing: MysqlProjectFile | null) => string;
  agentType: AgentType;
  sourceMessageId?: string;
  allowReplayFixture?: boolean;
  forceReplayFailure?: boolean;
}) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const project = await lockOwnedProject(connection, input.projectId, input.userId);
    if (!project) { await connection.rollback(); return { kind: "not-found" as const }; }
    const source = input.sourceMessageId
      ? await findSourceMessage(connection, { projectId: input.projectId, sourceMessageId: input.sourceMessageId, agentType: input.agentType })
      : null;
    if (input.sourceMessageId && !source) { await connection.rollback(); return { kind: "invalid-source" as const }; }
    if (!input.sourceMessageId && !input.allowReplayFixture) { await connection.rollback(); return { kind: "missing-source" as const }; }
    const [existingRows] = await connection.query<MysqlProjectFile[]>(
      `SELECT ${PROJECT_FILE_COLUMNS} FROM project_files WHERE project_id = ? AND filename = ? LIMIT 1 FOR UPDATE`,
      [input.projectId, input.filename]
    );
    const existing = existingRows[0];
    if (existing?.freeze_binding_tab_id) throw new MysqlFrozenDocumentError();
    const now = new Date();
    const content = input.buildContent ? input.buildContent(existing ?? null) : input.content;
    assertMysqlFileSize(content);
    const file: MysqlProjectFile = existing
      ? { ...existing, content, version: Number(existing.version) + 1, updated_at: now }
      : { id: randomUUID(), project_id: input.projectId, filename: input.filename, content, version: 1, created_at: now, updated_at: now } as MysqlProjectFile;
    if (existing) {
      const [updated] = await connection.execute<ResultSetHeader>(
        "UPDATE project_files SET content = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?",
        [file.content, file.version, file.updated_at, file.id, existing.version]
      );
      if (updated.affectedRows !== 1) throw new Error("项目文件版本冲突");
    } else {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO project_files (${PROJECT_FILE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [file.id, file.project_id, file.filename, file.content, file.version, file.created_at, file.updated_at, null, null, null]
      );
    }
    let write: MysqlMessageFileWrite | null = null;
    if (source) {
      write = {
        id: randomUUID(), filename: file.filename, operation: existing ? "update" : "create", file_version: file.version,
        message_status: "completed", write_status: "written", written_at: now,
      } as MysqlMessageFileWrite;
      await connection.execute<ResultSetHeader>(
        `INSERT INTO message_file_writes (id, message_id, tab_id, project_id, project_file_id, filename, operation, file_version, message_status, write_status, written_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'written', ?)`,
        [write.id, source.id, source.tab_id, input.projectId, file.id, file.filename, write.operation, write.file_version, write.written_at]
      );
    }
    if (input.forceReplayFailure) throw new Error("回放强制 MySQL 文件写入失败");
    await connection.commit();
    return { kind: "written" as const, file, write };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function lockOwnedProject(connection: PoolConnection, projectId: string, userId: string) {
  const [rows] = await connection.query<MysqlProject[]>(
    "SELECT id, user_id, name, created_at FROM projects WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE",
    [projectId, userId]
  );
  return rows[0] ?? null;
}

export async function updateMysqlProjectFile(input: { projectId: string; fileId: string; userId: string; content: string }) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    if (!(await lockOwnedProject(connection, input.projectId, input.userId))) { await connection.rollback(); return null; }
    const [rows] = await connection.query<MysqlProjectFile[]>(
      `SELECT ${PROJECT_FILE_COLUMNS} FROM project_files WHERE id = ? AND project_id = ? LIMIT 1 FOR UPDATE`, [input.fileId, input.projectId]
    );
    const file = rows[0];
    if (!file) { await connection.rollback(); return null; }
    if (file.freeze_binding_tab_id) throw new MysqlFrozenDocumentError();
    const updated = { ...file, content: input.content, version: Number(file.version) + 1, updated_at: new Date() } as MysqlProjectFile;
    await connection.execute<ResultSetHeader>("UPDATE project_files SET content = ?, version = ?, updated_at = ? WHERE id = ?", [updated.content, updated.version, updated.updated_at, updated.id]);
    await connection.commit();
    return updated;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function deleteMysqlProjectFile(projectId: string, fileId: string, userId: string) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    if (!(await lockOwnedProject(connection, projectId, userId))) { await connection.rollback(); return false; }
    const [files] = await connection.query<MysqlProjectFile[]>(
      `SELECT ${PROJECT_FILE_COLUMNS} FROM project_files WHERE id = ? AND project_id = ? LIMIT 1 FOR UPDATE`,
      [fileId, projectId]
    );
    if (!files[0]) { await connection.rollback(); return false; }
    if (files[0].freeze_binding_tab_id) throw new MysqlFrozenDocumentError();
    const [result] = await connection.execute<ResultSetHeader>("DELETE FROM project_files WHERE id = ? AND project_id = ?", [fileId, projectId]);
    await connection.commit();
    return result.affectedRows === 1;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

async function findOwnedMysqlTabProject(tabId: string, userId: string) {
  const [rows] = await getMysqlPool().query<Array<RowDataPacket & { tab_id: string; project_id: string }>>(
    `SELECT t.id AS tab_id, w.project_id FROM tabs t JOIN work_records w ON w.id = t.work_record_id JOIN projects p ON p.id = w.project_id WHERE t.id = ? AND p.user_id = ? LIMIT 1`, [tabId, userId]
  );
  return rows[0] ?? null;
}

export async function listMysqlLoadedContextFiles(tabId: string, projectId: string): Promise<MysqlLoadedFile[]> {
  const [rows] = await getMysqlPool().query<Array<MysqlProjectFile & RowDataPacket>>(
    `SELECT ${PROJECT_FILE_COLUMNS} FROM agent_file_contexts c JOIN project_files f ON f.id = c.file_id WHERE c.tab_id = ? AND f.project_id = ? ORDER BY c.loaded_at ASC, f.id ASC`, [tabId, projectId]
  );
  return rows.filter((file) => !isWorkingDocFile(file.filename) && !isConceptDocFile(file.filename)).map((file) => ({ _id: file.id, filename: file.filename, content: file.content, project_id: file.project_id, created_at: file.created_at, updated_at: file.updated_at }));
}

export async function addMysqlContextFile(tabId: string, fileId: string, userId: string) {
  const tab = await findOwnedMysqlTabProject(tabId, userId);
  if (!tab) return { kind: "tab-not-found" as const };
  const file = await findOwnedMysqlProjectFile(tab.project_id, fileId, userId);
  if (!file) return { kind: "file-not-found" as const };
  if (isWorkingDocFile(file.filename) || isConceptDocFile(file.filename)) return { kind: "not-loadable" as const };
  try {
    await getMysqlPool().execute<ResultSetHeader>("INSERT INTO agent_file_contexts (id, tab_id, file_id, loaded_at) VALUES (?, ?, ?, ?)", [randomUUID(), tabId, fileId, new Date()]);
    return { kind: "created" as const, file, projectId: tab.project_id };
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return { kind: "duplicate" as const };
    throw error;
  }
}

export async function removeMysqlContextFile(tabId: string, fileId: string, userId: string) {
  const tab = await findOwnedMysqlTabProject(tabId, userId);
  if (!tab) return { kind: "tab-not-found" as const };
  const file = await findOwnedMysqlProjectFile(tab.project_id, fileId, userId);
  if (!file) return { kind: "file-not-found" as const };
  const [result] = await getMysqlPool().execute<ResultSetHeader>("DELETE FROM agent_file_contexts WHERE tab_id = ? AND file_id = ?", [tabId, fileId]);
  return result.affectedRows === 1 ? { kind: "removed" as const } : { kind: "not-loaded" as const };
}

export async function listMysqlSnapshots(projectId: string, userId: string) {
  if (!(await findOwnedMysqlProject(projectId, userId))) return null;
  const [rows] = await getMysqlPool().query<MysqlPrototypeSnapshot[]>("SELECT id, project_id, tab_id, content, version, created_at FROM prototype_snapshots WHERE project_id = ? ORDER BY version DESC", [projectId]);
  return rows;
}

export async function createMysqlSnapshot(input: { projectId: string; userId: string; tabId?: string; content: string }) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    if (!(await lockOwnedProject(connection, input.projectId, input.userId))) { await connection.rollback(); return { kind: "project-not-found" as const }; }
    if (input.tabId) {
      const [tabs] = await connection.query<Array<RowDataPacket & { id: string }>>(
        `SELECT t.id FROM tabs t JOIN work_records w ON w.id = t.work_record_id WHERE t.id = ? AND w.project_id = ? LIMIT 1 FOR UPDATE`, [input.tabId, input.projectId]
      );
      if (!tabs[0]) { await connection.rollback(); return { kind: "tab-not-found" as const }; }
    }
    const [versions] = await connection.query<Array<RowDataPacket & { version: number | null }>>("SELECT MAX(version) AS version FROM prototype_snapshots WHERE project_id = ? FOR UPDATE", [input.projectId]);
    const snapshot = { id: randomUUID(), project_id: input.projectId, tab_id: input.tabId ?? null, content: input.content, version: Number(versions[0]?.version ?? 0) + 1, created_at: new Date() } as MysqlPrototypeSnapshot;
    await connection.execute<ResultSetHeader>("INSERT INTO prototype_snapshots (id, project_id, tab_id, content, version, created_at) VALUES (?, ?, ?, ?, ?, ?)", [snapshot.id, snapshot.project_id, snapshot.tab_id, snapshot.content, snapshot.version, snapshot.created_at]);
    await connection.commit();
    return { kind: "created" as const, snapshot };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function findMysqlSnapshot(projectId: string, snapshotId: string, userId: string) {
  if (!(await findOwnedMysqlProject(projectId, userId))) return null;
  const [rows] = await getMysqlPool().query<MysqlPrototypeSnapshot[]>("SELECT id, project_id, tab_id, content, version, created_at FROM prototype_snapshots WHERE id = ? AND project_id = ? LIMIT 1", [snapshotId, projectId]);
  return rows[0] ?? null;
}

export async function listMysqlMessageFileWrites(messageIds: string[]) {
  if (messageIds.length === 0) return [] as MysqlMessageFileWrite[];
  const [rows] = await getMysqlPool().query<MysqlMessageFileWrite[]>(
    `SELECT id, filename, operation, file_version, message_status, write_status, written_at, message_id
     FROM message_file_writes WHERE message_id IN (${messageIds.map(() => "?").join(", ")}) ORDER BY written_at ASC, id ASC`,
    messageIds
  );
  return rows;
}

function ticketVersion(filename: string) {
  const match = filename.match(/^issues(?:\/v(\d+))?\//u);
  return match?.[1] ? Number(match[1]) : 0;
}

export async function listMysqlTicketSets(projectId: string, userId: string) {
  const files = await listMysqlProjectFiles(projectId, userId);
  if (!files) return null;
  const ticketFiles = files.filter((file) => file.filename.startsWith("issues/"));
  const grouped = new Map<number, MysqlProjectFile[]>();
  for (const file of ticketFiles) {
    const version = ticketVersion(file.filename);
    grouped.set(version, [...(grouped.get(version) ?? []), file]);
  }
  const versions = [...grouped.keys()].sort((a, b) => a - b);
  const currentVersion = versions.at(-1) ?? 0;
  return {
    currentVersion,
    versions: versions.map((version) => ({ version, current: version === currentVersion, files: (grouped.get(version) ?? []).sort((a, b) => a.filename.localeCompare(b.filename)).map((file) => ({ id: file.id, filename: file.filename, version: Number(file.version), updated_at: file.updated_at })) })),
  };
}

export async function downloadMysqlTicketSet(projectId: string, userId: string, version: number) {
  const sets = await listMysqlTicketSets(projectId, userId);
  if (!sets) return null;
  const selected = sets.versions.find((entry) => entry.version === version);
  if (!selected) return { kind: "version-not-found" as const };
  const files = await Promise.all(selected.files.map((file) => findOwnedMysqlProjectFile(projectId, file.id, userId)));
  return { kind: "found" as const, currentVersion: sets.currentVersion, files: files.filter((file): file is MysqlProjectFile => Boolean(file)).map((file) => ({ filename: file.filename, content: file.content })) };
}

export async function deliverMysqlTicketSet(input: { projectId: string; userId: string; sourceMessageId: string; mode: "replace" | "save"; candidates: Array<{ filename: string; content: string }> }) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    if (!(await lockOwnedProject(connection, input.projectId, input.userId))) { await connection.rollback(); return { kind: "project-not-found" as const }; }
    const source = await findSourceMessage(connection, { projectId: input.projectId, sourceMessageId: input.sourceMessageId, agentType: "ticket_splitter" });
    if (!source) { await connection.rollback(); return { kind: "invalid-source" as const }; }
    const [allFiles] = await connection.query<MysqlProjectFile[]>(
      `SELECT ${PROJECT_FILE_COLUMNS} FROM project_files WHERE project_id = ? AND filename LIKE 'issues/%' FOR UPDATE`, [input.projectId]
    );
    const currentVersion = allFiles.reduce((max, file) => Math.max(max, ticketVersion(file.filename)), 0);
    const version = input.mode === "save" ? currentVersion + 1 : 0;
    const targets = input.candidates.map((candidate) => ({ ...candidate, filename: input.mode === "save" ? `issues/v${version}/${candidate.filename.slice("issues/".length)}` : candidate.filename }));
    const targetNames = new Set(targets.map((target) => target.filename));
    if (input.mode === "replace") {
      const stale = allFiles.filter((file) => ticketVersion(file.filename) === 0 && !targetNames.has(file.filename));
      if (stale.length > 0) await connection.execute<ResultSetHeader>(`DELETE FROM project_files WHERE id IN (${stale.map(() => "?").join(", ")})`, stale.map((file) => file.id));
    }
    const written: Array<{ file: MysqlProjectFile; write: MysqlMessageFileWrite }> = [];
    for (const target of targets) {
      const existing = allFiles.find((file) => file.filename === target.filename);
      const now = new Date();
      const content = `${formatChangelogHeader({ requirement_count: 0, iteration: Number(existing?.version ?? 0) + 1, last_editor: "ticket_splitter", timestamp: now })}\n${target.content}`;
      assertMysqlFileSize(content);
      const file = existing
        ? { ...existing, content, version: Number(existing.version) + 1, updated_at: now }
        : { id: randomUUID(), project_id: input.projectId, filename: target.filename, content, version: 1, created_at: now, updated_at: now } as MysqlProjectFile;
      if (existing) {
        await connection.execute<ResultSetHeader>("UPDATE project_files SET content = ?, version = ?, updated_at = ? WHERE id = ?", [file.content, file.version, file.updated_at, file.id]);
      } else {
        await connection.execute<ResultSetHeader>(`INSERT INTO project_files (${PROJECT_FILE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [file.id, file.project_id, file.filename, file.content, file.version, file.created_at, file.updated_at, null, null, null]);
      }
      const write = { id: randomUUID(), filename: file.filename, operation: existing ? "update" : "create", file_version: file.version, message_status: "completed", write_status: "written", written_at: now } as MysqlMessageFileWrite;
      await connection.execute<ResultSetHeader>(
        `INSERT INTO message_file_writes (id, message_id, tab_id, project_id, project_file_id, filename, operation, file_version, message_status, write_status, written_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'written', ?)`,
        [write.id, source.id, source.tab_id, input.projectId, file.id, file.filename, write.operation, write.file_version, write.written_at]
      );
      written.push({ file, write });
    }
    await connection.commit();
    return { kind: "delivered" as const, version, currentVersion: input.mode === "save" ? version : currentVersion, written };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
