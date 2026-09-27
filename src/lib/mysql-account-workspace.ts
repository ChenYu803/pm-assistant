import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { AGENT_TYPE_LABELS, type AgentType, type FreezeStatus } from "@/lib/agent-constants";
import { isMysqlId } from "@/lib/identifiers";
import { getMysqlPool } from "@/lib/mysql";


export interface MysqlUser extends RowDataPacket {
  id: string;
  email: string;
  nickname: string | null;
  password_hash: string;
  created_at: Date;
}

export interface MysqlProject extends RowDataPacket {
  id: string;
  user_id: string;
  name: string;
  created_at: Date;
}

export interface MysqlWorkRecord extends RowDataPacket {
  id: string;
  project_id: string;
  name: string;
  created_at: Date;
}

export interface MysqlProductIteration extends RowDataPacket {
  id: string;
  project_id: string;
  iteration_number: number;
  display_name: string;
  goal: string | null;
  created_at: Date;
  updated_at: Date;
};

export interface MysqlTab extends RowDataPacket {
  id: string;
  work_record_id: string;
  agent_type: AgentType;
  display_name: string;
  position: number;
  version: number;
  scope_frozen: boolean;
  freeze_status: FreezeStatus;
  freeze_message_id: string | null;
  freeze_filename: string | null;
  freeze_document_digest: string | null;
  freeze_error: string | null;
  active_operation_id: string | null;
  created_at: Date;
}

type CountRow = RowDataPacket & { count: number; position: number | null };

export { isMysqlId } from "@/lib/identifiers";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function newMysqlId() {
  return randomUUID();
}

function mapTab(row: MysqlTab): MysqlTab {
  return {
    ...row,
    scope_frozen: Boolean(row.scope_frozen),
  };
}

export async function findMysqlUserByEmail(email: string): Promise<MysqlUser | null> {
  const [rows] = await getMysqlPool().query<MysqlUser[]>(
    "SELECT id, email, nickname, password_hash, created_at FROM users WHERE email = ? LIMIT 1",
    [normalizeEmail(email)]
  );
  return rows[0] ?? null;
}

export async function findMysqlUserById(id: string): Promise<MysqlUser | null> {
  if (!isMysqlId(id)) return null;
  const [rows] = await getMysqlPool().query<MysqlUser[]>(
    "SELECT id, email, nickname, password_hash, created_at FROM users WHERE id = ? LIMIT 1",
    [id]
  );
  return rows[0] ?? null;
}

export async function updateMysqlNickname(id: string, nickname: string): Promise<boolean> {
  const [result] = await getMysqlPool().execute<ResultSetHeader>(
    "UPDATE users SET nickname = ? WHERE id = ?",
    [nickname, id]
  );
  return result.affectedRows > 0;
}

export async function updateMysqlPassword(id: string, previousHash: string, nextHash: string): Promise<boolean> {
  const [result] = await getMysqlPool().execute<ResultSetHeader>(
    "UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?",
    [nextHash, id, previousHash]
  );
  return result.affectedRows > 0;
}

export async function createMysqlUser(email: string, passwordHash: string): Promise<MysqlUser> {
  const user = {
    id: newMysqlId(),
    email: normalizeEmail(email),
    nickname: null,
    password_hash: passwordHash,
    created_at: new Date(),
  } as MysqlUser;
  await getMysqlPool().execute<ResultSetHeader>(
    "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
    [user.id, user.email, user.password_hash, user.created_at]
  );
  return user;
}

export async function listMysqlProjects(userId: string): Promise<MysqlProject[]> {
  const [rows] = await getMysqlPool().query<MysqlProject[]>(
    "SELECT id, user_id, name, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC, id DESC",
    [userId]
  );
  return rows;
}

export async function findOwnedMysqlProject(projectId: string, userId: string): Promise<MysqlProject | null> {
  if (!isMysqlId(projectId)) return null;
  const [rows] = await getMysqlPool().query<MysqlProject[]>(
    "SELECT id, user_id, name, created_at FROM projects WHERE id = ? AND user_id = ? LIMIT 1",
    [projectId, userId]
  );
  return rows[0] ?? null;
}

export async function createMysqlProject(userId: string, name: string): Promise<MysqlProject> {
  const project = { id: newMysqlId(), user_id: userId, name, created_at: new Date() } as MysqlProject;
  await getMysqlPool().execute<ResultSetHeader>(
    "INSERT INTO projects (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
    [project.id, project.user_id, project.name, project.created_at]
  );
  return project;
}

export async function renameMysqlProject(projectId: string, userId: string, name: string): Promise<MysqlProject | null> {
  if (!isMysqlId(projectId)) return null;
  const [result] = await getMysqlPool().execute<ResultSetHeader>(
    "UPDATE projects SET name = ? WHERE id = ? AND user_id = ?",
    [name, projectId, userId]
  );
  if (result.affectedRows === 0) return null;
  return findOwnedMysqlProject(projectId, userId);
}

export async function listMysqlWorkRecords(projectId: string, userId: string): Promise<MysqlWorkRecord[] | null> {
  if (!(await findOwnedMysqlProject(projectId, userId))) return null;
  const [rows] = await getMysqlPool().query<MysqlWorkRecord[]>(
    "SELECT id, project_id, name, created_at FROM work_records WHERE project_id = ? ORDER BY created_at DESC, id DESC",
    [projectId]
  );
  return rows;
}

export async function listMysqlProductIterations(projectId: string, userId: string): Promise<MysqlProductIteration[] | null> {
  if (!(await findOwnedMysqlProject(projectId, userId))) return null;
  const [rows] = await getMysqlPool().query<MysqlProductIteration[]>(
    `SELECT id, project_id, iteration_number, display_name, goal, created_at, updated_at
     FROM product_iterations
     WHERE project_id = ?
     ORDER BY iteration_number DESC, id DESC`,
    [projectId]
  );
  return rows;
}

export async function findOwnedMysqlWorkRecord(workRecordId: string, userId: string): Promise<MysqlWorkRecord | null> {
  if (!isMysqlId(workRecordId)) return null;
  const [rows] = await getMysqlPool().query<MysqlWorkRecord[]>(
    `SELECT w.id, w.project_id, w.name, w.created_at
     FROM work_records w
     JOIN projects p ON p.id = w.project_id
     WHERE w.id = ? AND p.user_id = ? LIMIT 1`,
    [workRecordId, userId]
  );
  return rows[0] ?? null;
}

export async function findOwnedMysqlProductIteration(iterationId: string, userId: string): Promise<MysqlProductIteration | null> {
  if (!isMysqlId(iterationId)) return null;
  const [rows] = await getMysqlPool().query<MysqlProductIteration[]>(
    `SELECT i.id, i.project_id, i.iteration_number, i.display_name, i.goal, i.created_at, i.updated_at
     FROM product_iterations i
     JOIN projects p ON p.id = i.project_id
     WHERE i.id = ? AND p.user_id = ? LIMIT 1`,
    [iterationId, userId]
  );
  return rows[0] ?? null;
}

export async function createMysqlProductIteration(
  projectId: string,
  userId: string,
  name: string,
  goal: string | null,
): Promise<MysqlProductIteration | null> {
  if (!isMysqlId(projectId)) return null;
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [projectRows] = await connection.query<Array<RowDataPacket & { id: string; next_iteration_number: number }>>(
      "SELECT id, next_iteration_number FROM projects WHERE id = ? AND user_id = ? FOR UPDATE",
      [projectId, userId],
    );
    const project = projectRows[0];
    if (!project) {
      await connection.rollback();
      return null;
    }

    const iterationNumber = Number(project.next_iteration_number || 1);
    const iteration = {
      id: newMysqlId(),
      project_id: projectId,
      iteration_number: iterationNumber,
      display_name: name,
      goal,
      created_at: new Date(),
      updated_at: new Date(),
    } as MysqlProductIteration;
    await connection.execute<ResultSetHeader>(
      `INSERT INTO product_iterations (id, project_id, iteration_number, display_name, goal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [iteration.id, iteration.project_id, iteration.iteration_number, iteration.display_name, iteration.goal, iteration.created_at, iteration.updated_at],
    );
    await connection.execute<ResultSetHeader>(
      "UPDATE projects SET next_iteration_number = ? WHERE id = ? AND user_id = ?",
      [iterationNumber + 1, projectId, userId],
    );
    await connection.commit();
    return iteration;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateMysqlProductIteration(
  iterationId: string,
  userId: string,
  name: string,
  goal: string | null,
): Promise<MysqlProductIteration | null> {
  const iteration = await findOwnedMysqlProductIteration(iterationId, userId);
  if (!iteration) return null;
  await getMysqlPool().execute<ResultSetHeader>(
    "UPDATE product_iterations SET display_name = ?, goal = ? WHERE id = ?",
    [name, goal, iteration.id],
  );
  return findOwnedMysqlProductIteration(iteration.id, userId);
}

export async function deleteMysqlProductIteration(
  iterationId: string,
  userId: string,
): Promise<boolean> {
  if (!isMysqlId(iterationId)) return false;
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [iterationRows] = await connection.query<Array<RowDataPacket & { project_id: string }>>(
      "SELECT project_id FROM product_iterations WHERE id = ? LIMIT 1",
      [iterationId],
    );
    const projectId = iterationRows[0]?.project_id;
    if (!projectId) {
      await connection.rollback();
      return false;
    }
    const [projectRows] = await connection.query<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM projects WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE",
      [projectId, userId],
    );
    if (!projectRows[0]) {
      await connection.rollback();
      return false;
    }
    const [rows] = await connection.query<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM product_iterations WHERE id = ? AND project_id = ? LIMIT 1 FOR UPDATE",
      [iterationId, projectId],
    );
    const iteration = rows[0];
    if (!iteration) {
      await connection.rollback();
      return false;
    }
    const [result] = await connection.execute<ResultSetHeader>(
      "DELETE FROM product_iterations WHERE id = ? AND project_id = ?",
      [iteration.id, projectId],
    );
    if (result.affectedRows !== 1) throw new Error("产品迭代删除未完成");
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createMysqlWorkRecord(projectId: string, userId: string, name: string): Promise<MysqlWorkRecord | null> {
  if (!(await findOwnedMysqlProject(projectId, userId))) return null;
  const workRecord = { id: newMysqlId(), project_id: projectId, name, created_at: new Date() } as MysqlWorkRecord;
  await getMysqlPool().execute<ResultSetHeader>(
    "INSERT INTO work_records (id, project_id, name, created_at) VALUES (?, ?, ?, ?)",
    [workRecord.id, workRecord.project_id, workRecord.name, workRecord.created_at]
  );
  return workRecord;
}

export async function renameMysqlWorkRecord(workRecordId: string, userId: string, name: string): Promise<MysqlWorkRecord | null> {
  const record = await findOwnedMysqlWorkRecord(workRecordId, userId);
  if (!record) return null;
  await getMysqlPool().execute<ResultSetHeader>("UPDATE work_records SET name = ? WHERE id = ?", [name, record.id]);
  return { ...record, name };
}

export async function listMysqlTabs(workRecordId: string, userId: string): Promise<MysqlTab[] | null> {
  if (!(await findOwnedMysqlWorkRecord(workRecordId, userId))) return null;
  const [rows] = await getMysqlPool().query<MysqlTab[]>(
    `SELECT id, work_record_id, agent_type, display_name, position, version, scope_frozen, freeze_status, freeze_message_id, freeze_filename, freeze_document_digest, freeze_error, active_operation_id, created_at
     FROM tabs WHERE work_record_id = ? ORDER BY position ASC, created_at ASC, id ASC`,
    [workRecordId]
  );
  return rows.map(mapTab);
}

async function findOwnedMysqlWorkRecordForUpdate(connection: PoolConnection, workRecordId: string, userId: string) {
  const [rows] = await connection.query<MysqlWorkRecord[]>(
    `SELECT w.id, w.project_id, w.name, w.created_at
     FROM work_records w
     JOIN projects p ON p.id = w.project_id
     WHERE w.id = ? AND p.user_id = ? FOR UPDATE`,
    [workRecordId, userId]
  );
  return rows[0] ?? null;
}

export async function createMysqlTab(workRecordId: string, userId: string, agentType: AgentType): Promise<MysqlTab | null> {
  if (!isMysqlId(workRecordId)) return null;
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const workRecord = await findOwnedMysqlWorkRecordForUpdate(connection, workRecordId, userId);
    if (!workRecord) {
      await connection.rollback();
      return null;
    }
    const [countRows] = await connection.query<CountRow[]>(
      "SELECT COUNT(*) AS count FROM tabs WHERE work_record_id = ? AND agent_type = ?",
      [workRecord.id, agentType]
    );
    const [positionRows] = await connection.query<CountRow[]>(
      "SELECT MAX(position) AS position FROM tabs WHERE work_record_id = ?",
      [workRecord.id]
    );
    const tab = {
      id: newMysqlId(),
      work_record_id: workRecord.id,
      agent_type: agentType,
      display_name: `${AGENT_TYPE_LABELS[agentType]} #${Number(countRows[0]?.count ?? 0) + 1}`,
      position: Number(positionRows[0]?.position ?? -1) + 1,
      version: 0,
      scope_frozen: false,
      freeze_status: "idle",
      freeze_message_id: null,
      freeze_filename: null,
      freeze_document_digest: null,
      freeze_error: null,
      active_operation_id: null,
      created_at: new Date(),
    } as MysqlTab;
    await connection.execute<ResultSetHeader>(
      `INSERT INTO tabs (id, work_record_id, agent_type, display_name, position, version, scope_frozen, freeze_status, freeze_message_id, freeze_filename, freeze_document_digest, freeze_error, active_operation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tab.id, tab.work_record_id, tab.agent_type, tab.display_name, tab.position, tab.version, tab.scope_frozen, tab.freeze_status, tab.freeze_message_id, tab.freeze_filename, tab.freeze_document_digest, tab.freeze_error, tab.active_operation_id, tab.created_at]
    );
    await connection.commit();
    return tab;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export type MysqlTabRenameResult =
  | { kind: "not-found" }
  | { kind: "request-id-mismatch" }
  | { kind: "conflict"; currentVersion: number }
  | { kind: "updated"; tab: MysqlTab };

type MysqlTabOperation = RowDataPacket & {
  operation: string;
  status: "completed" | "conflict";
  response_json: MysqlTab | string | null;
  tab_version: number | null;
};

function parseStoredTab(value: MysqlTabOperation["response_json"]): MysqlTab | null {
  if (!value) return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object") return null;
  return mapTab(parsed as MysqlTab);
}

export async function renameMysqlTab(
  tabId: string,
  userId: string,
  displayName: string,
  expectedVersion: number,
  requestId: string
): Promise<MysqlTabRenameResult> {
  if (!isMysqlId(tabId)) return { kind: "not-found" };
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [tabRows] = await connection.query<MysqlTab[]>(
      `SELECT t.id, t.work_record_id, t.agent_type, t.display_name, t.position, t.version, t.scope_frozen, t.freeze_status, t.freeze_message_id, t.freeze_filename, t.freeze_document_digest, t.freeze_error, t.active_operation_id, t.created_at
       FROM tabs t
       JOIN work_records w ON w.id = t.work_record_id
       JOIN projects p ON p.id = w.project_id
       WHERE t.id = ? AND p.user_id = ? FOR UPDATE`,
      [tabId, userId]
    );
    const existingTab = tabRows[0];
    if (!existingTab) {
      await connection.rollback();
      return { kind: "not-found" };
    }

    const [operationRows] = await connection.query<MysqlTabOperation[]>(
      "SELECT operation, status, response_json, tab_version FROM tab_operations WHERE tab_id = ? AND request_id = ? LIMIT 1",
      [tabId, requestId]
    );
    const existingOperation = operationRows[0];
    if (existingOperation) {
      await connection.rollback();
      if (existingOperation.operation !== "rename-tab") return { kind: "request-id-mismatch" };
      if (existingOperation.status === "conflict") {
        return { kind: "conflict", currentVersion: Number(existingOperation.tab_version ?? existingTab.version) };
      }
      const tab = parseStoredTab(existingOperation.response_json);
      return tab ? { kind: "updated", tab } : { kind: "conflict", currentVersion: existingTab.version };
    }

    if (existingTab.version !== expectedVersion) {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO tab_operations (id, tab_id, request_id, operation, expected_version, status, tab_version)
         VALUES (?, ?, ?, 'rename-tab', ?, 'conflict', ?)`,
        [newMysqlId(), tabId, requestId, expectedVersion, existingTab.version]
      );
      await connection.commit();
      return { kind: "conflict", currentVersion: existingTab.version };
    }

    const tab = mapTab({ ...existingTab, display_name: displayName, version: existingTab.version + 2 });
    await connection.execute<ResultSetHeader>(
      "UPDATE tabs SET display_name = ?, version = ? WHERE id = ? AND version = ?",
      [tab.display_name, tab.version, tab.id, expectedVersion]
    );
    await connection.execute<ResultSetHeader>(
      `INSERT INTO tab_operations (id, tab_id, request_id, operation, expected_version, status, response_json, tab_version)
       VALUES (?, ?, ?, 'rename-tab', ?, 'completed', ?, ?)`,
      [newMysqlId(), tabId, requestId, expectedVersion, JSON.stringify(tab), tab.version]
    );
    await connection.commit();
    return { kind: "updated", tab };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
