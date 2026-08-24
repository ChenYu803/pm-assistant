import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { MysqlTab } from "@/lib/mysql-account-workspace";
import { getMysqlPool } from "@/lib/mysql";

export const MYSQL_TAB_CONFLICT_MESSAGE = "此标签页正在被其他窗口修改";

export interface MysqlTabMutationRequest {
  expectedVersion: number;
  requestId: string;
}

export interface MysqlTabOperation {
  id: string;
  tab_id: string;
  request_id: string;
  operation: string;
  expected_version: number;
  locked_version: number | null;
  status: "pending" | "processing" | "completed" | "conflict" | "failed";
  response_json: Record<string, unknown> | string | null;
  tab_version: number | null;
}

export type MysqlOperationStart =
  | { kind: "claimed"; tab: MysqlTab; operation: MysqlTabOperation; metadata?: unknown }
  | { kind: "replay"; operation: MysqlTabOperation }
  | { kind: "conflict"; currentVersion: number | null }
  | { kind: "request-id-mismatch" }
  | { kind: "not-found" };

export function parseMysqlTabMutationRequest(value: unknown): MysqlTabMutationRequest | null {
  if (!value || typeof value !== "object") return null;
  const { expectedVersion, requestId } = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(expectedVersion) ||
    typeof expectedVersion !== "number" ||
    expectedVersion < 0 ||
    typeof requestId !== "string" ||
    !requestId.trim() ||
    requestId.length > 160
  ) return null;
  return { expectedVersion, requestId: requestId.trim() };
}

function mapTab(tab: MysqlTab): MysqlTab {
  return { ...tab, scope_frozen: Boolean(tab.scope_frozen) };
}

function parseOperation(row: MysqlTabOperation): MysqlTabOperation {
  return {
    ...row,
    response_json: typeof row.response_json === "string" ? JSON.parse(row.response_json) : row.response_json,
  };
}

async function getOwnedTabForUpdate(connection: PoolConnection, tabId: string, userId: string) {
  const [rows] = await connection.query<MysqlTab[]>(
    `SELECT t.id, t.work_record_id, t.agent_type, t.display_name, t.position, t.version, t.scope_frozen, t.freeze_status, t.active_operation_id, t.created_at
     FROM tabs t
     JOIN work_records w ON w.id = t.work_record_id
     JOIN projects p ON p.id = w.project_id
     WHERE t.id = ? AND p.user_id = ? FOR UPDATE`,
    [tabId, userId]
  );
  return rows[0] ? mapTab(rows[0]) : null;
}

async function existingOperation(connection: PoolConnection, tabId: string, requestId: string) {
  const [rows] = await connection.query<Array<MysqlTabOperation & RowDataPacket>>(
    "SELECT id, tab_id, request_id, operation, expected_version, locked_version, status, response_json, tab_version FROM tab_operations WHERE tab_id = ? AND request_id = ? LIMIT 1",
    [tabId, requestId]
  );
  return rows[0] ? parseOperation(rows[0]) : null;
}

export async function beginMysqlTabOperation({ tabId, userId, operation, request, passive = false, onClaimed }: {
  tabId: string;
  userId: string;
  operation: string;
  request: MysqlTabMutationRequest;
  passive?: boolean;
  onClaimed?: (connection: PoolConnection, tab: MysqlTab, operation: MysqlTabOperation) => Promise<unknown>;
}): Promise<MysqlOperationStart> {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const tab = await getOwnedTabForUpdate(connection, tabId, userId);
    if (!tab) {
      await connection.rollback();
      return { kind: "not-found" };
    }
    const replay = await existingOperation(connection, tabId, request.requestId);
    if (replay) {
      await connection.rollback();
      return replay.operation === operation ? { kind: "replay", operation: replay } : { kind: "request-id-mismatch" };
    }
    if (tab.version !== request.expectedVersion || (!passive && tab.active_operation_id)) {
      await connection.execute<ResultSetHeader>(
        "INSERT INTO tab_operations (id, tab_id, request_id, operation, expected_version, status, tab_version) VALUES (?, ?, ?, ?, ?, 'conflict', ?)",
        [randomUUID(), tabId, request.requestId, operation, request.expectedVersion, tab.version]
      );
      await connection.commit();
      return { kind: "conflict", currentVersion: tab.version };
    }
    const lockedVersion = passive ? tab.version : tab.version + 1;
    const operationId = randomUUID();
    if (!passive) {
      await connection.execute<ResultSetHeader>(
        "UPDATE tabs SET version = ?, active_operation_id = ? WHERE id = ? AND version = ? AND active_operation_id IS NULL",
        [lockedVersion, request.requestId, tabId, tab.version]
      );
    }
    const operationRecord: MysqlTabOperation = { id: operationId, tab_id: tabId, request_id: request.requestId, operation, expected_version: request.expectedVersion, locked_version: lockedVersion, status: "processing", response_json: null, tab_version: lockedVersion };
    await connection.execute<ResultSetHeader>(
      "INSERT INTO tab_operations (id, tab_id, request_id, operation, expected_version, locked_version, status, tab_version) VALUES (?, ?, ?, ?, ?, ?, 'processing', ?)",
      [operationId, tabId, request.requestId, operation, request.expectedVersion, lockedVersion, lockedVersion]
    );
    const metadata = onClaimed
      ? await onClaimed(connection, { ...tab, version: lockedVersion, active_operation_id: passive ? tab.active_operation_id : request.requestId }, operationRecord)
      : undefined;
    await connection.commit();
    return {
      kind: "claimed",
      tab: { ...tab, version: lockedVersion, active_operation_id: passive ? tab.active_operation_id : request.requestId },
      operation: operationRecord,
      metadata,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function completeMysqlTabOperation(operation: MysqlTabOperation, result: Record<string, unknown> = {}) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const lockedVersion = operation.locked_version ?? operation.expected_version;
    let tabVersion = lockedVersion;
    if (operation.operation !== "stop-generation") {
      tabVersion = lockedVersion + 1;
      const [updated] = await connection.execute<ResultSetHeader>(
        "UPDATE tabs SET version = ?, active_operation_id = NULL WHERE id = ? AND version = ? AND active_operation_id = ?",
        [tabVersion, operation.tab_id, lockedVersion, operation.request_id]
      );
      if (updated.affectedRows !== 1) throw new Error("标签页并发状态异常，无法完成操作");
    }
    await connection.execute<ResultSetHeader>(
      "UPDATE tab_operations SET status = 'completed', response_json = ?, tab_version = ? WHERE id = ?",
      [JSON.stringify(result), tabVersion, operation.id]
    );
    await connection.commit();
    return tabVersion;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function failMysqlTabOperation(operation: MysqlTabOperation, error: string) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const lockedVersion = operation.locked_version ?? operation.expected_version;
    const tabVersion = operation.operation === "stop-generation" ? lockedVersion : lockedVersion + 1;
    if (operation.operation !== "stop-generation") {
      await connection.execute<ResultSetHeader>(
        "UPDATE tabs SET version = ?, active_operation_id = NULL WHERE id = ? AND version = ? AND active_operation_id = ?",
        [tabVersion, operation.tab_id, lockedVersion, operation.request_id]
      );
    }
    await connection.execute<ResultSetHeader>(
      "UPDATE tab_operations SET status = 'failed', response_json = ?, tab_version = ? WHERE id = ?",
      [JSON.stringify({ error }), tabVersion, operation.id]
    );
    await connection.commit();
    return tabVersion;
  } catch (failure) {
    await connection.rollback();
    throw failure;
  } finally {
    connection.release();
  }
}

export async function waitForMysqlTabOperation(operation: MysqlTabOperation, attempts = 40) {
  let current = operation;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (["completed", "conflict", "failed"].includes(current.status) || current.response_json) return current;
    await new Promise((resolve) => setTimeout(resolve, 25));
    const [rows] = await getMysqlPool().query<Array<MysqlTabOperation & RowDataPacket>>(
      "SELECT id, tab_id, request_id, operation, expected_version, locked_version, status, response_json, tab_version FROM tab_operations WHERE id = ?",
      [operation.id]
    );
    if (!rows[0]) return current;
    current = parseOperation(rows[0]);
  }
  return current;
}
