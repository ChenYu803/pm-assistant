import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { getMysqlPool } from "@/lib/mysql";
import type { MysqlTab } from "@/lib/mysql-account-workspace";
import type { MysqlTabMutationRequest, MysqlTabOperation } from "@/lib/mysql-tab-concurrency";
import {
  beginMysqlTabOperation,
  completeMysqlTabOperationInTransaction,
  failMysqlTabOperation,
  MYSQL_TAB_CONFLICT_MESSAGE,
  waitForMysqlTabOperation,
} from "@/lib/mysql-tab-concurrency";

type MutationFailureStep =
  | "agent-file-contexts"
  | "freeze-bindings"
  | "message-file-writes"
  | "message-references"
  | "messages"
  | "tab-operations"
  | "tab";

export interface MysqlTabMessageMutationOptions {
  failAfterStep?: MutationFailureStep;
}

export interface MysqlTabMessageMutationResult {
  status: number;
  body: Record<string, unknown>;
}

type StoredMutationResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

type MysqlMessageRow = RowDataPacket & {
  id: string;
  role: "user" | "assistant";
};

type MysqlDeletedTabOperationRow = RowDataPacket & {
  user_id: string;
  response_json: Record<string, unknown> | string;
  tab_version: number;
};

function testFailure(step: MutationFailureStep, options: MysqlTabMessageMutationOptions) {
  if (options.failAfterStep === step) {
    throw new Error(`标签页消息变更测试故障：${step} 已处理`);
  }
}

export function getMysqlTabMessageMutationTestOptions(request: Request): MysqlTabMessageMutationOptions {
  if (process.env.CASCADE_DELETE_TEST_HOOKS !== "1") return {};
  const step = request.headers.get("x-pm-assistant-test-tab-message-mutation-fail-after");
  const steps: MutationFailureStep[] = [
    "agent-file-contexts",
    "freeze-bindings",
    "message-file-writes",
    "message-references",
    "messages",
    "tab-operations",
    "tab",
  ];
  return steps.includes(step as MutationFailureStep)
    ? { failAfterStep: step as MutationFailureStep }
    : {};
}

function conflict(currentVersion: number | null): MysqlTabMessageMutationResult {
  return {
    status: 409,
    body: {
      error: MYSQL_TAB_CONFLICT_MESSAGE,
      code: "TAB_VERSION_CONFLICT",
      currentVersion,
    },
  };
}

function operationResult(
  result: StoredMutationResult,
  tabVersion: number | null
): MysqlTabMessageMutationResult {
  return {
    status: result.httpStatus,
    body: {
      ...result.body,
      ...(tabVersion === null ? {} : { tabVersion }),
    },
  };
}

function parseStoredResult(value: unknown): StoredMutationResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.httpStatus !== "number" ||
    !Number.isInteger(candidate.httpStatus) ||
    !candidate.body ||
    typeof candidate.body !== "object" ||
    Array.isArray(candidate.body)
  ) return null;
  return {
    httpStatus: candidate.httpStatus,
    body: candidate.body as Record<string, unknown>,
  };
}

async function replayOperation(operation: MysqlTabOperation): Promise<MysqlTabMessageMutationResult> {
  const replay = await waitForMysqlTabOperation(operation);
  if (replay.status === "conflict") return conflict(replay.tab_version);
  const stored = parseStoredResult(replay.response_json);
  if (stored) return operationResult(stored, replay.tab_version);
  if (replay.status === "failed") {
    return { status: 500, body: { error: "消息变更失败，请手动重试", tabVersion: replay.tab_version } };
  }
  return { status: 409, body: { error: "请求正在处理中，请稍后重试" } };
}

async function clearMessageReferences(
  connection: PoolConnection,
  messageIds: string[],
  options: MysqlTabMessageMutationOptions
) {
  if (messageIds.length === 0) return;
  const placeholders = messageIds.map(() => "?").join(", ");
  await connection.execute<ResultSetHeader>(
    `UPDATE messages
     SET replacement_target_id = NULL,
         replacement_commit_message_id = NULL,
         superseded_by_message_id = NULL,
         replacement_user_message_id = NULL
     WHERE replacement_target_id IN (${placeholders})
        OR replacement_commit_message_id IN (${placeholders})
        OR superseded_by_message_id IN (${placeholders})
        OR replacement_user_message_id IN (${placeholders})`,
    [...messageIds, ...messageIds, ...messageIds, ...messageIds]
  );
  testFailure("message-references", options);
}

async function releaseFreezeForDeletedMessages(
  connection: PoolConnection,
  tabId: string,
  messageIds: string[],
  options: MysqlTabMessageMutationOptions
) {
  if (messageIds.length === 0) return;
  const placeholders = messageIds.map(() => "?").join(", ");
  const [affectedTabs] = await connection.execute<ResultSetHeader>(
    `UPDATE tabs
     SET scope_frozen = FALSE,
         freeze_status = 'idle',
         freeze_message_id = NULL,
         freeze_filename = NULL,
         freeze_document_digest = NULL,
         freeze_error = NULL
     WHERE id = ? AND freeze_message_id IN (${placeholders})`,
    [tabId, ...messageIds]
  );
  if (affectedTabs.affectedRows > 0) {
    await connection.execute<ResultSetHeader>(
      `UPDATE project_files
       SET freeze_binding_tab_id = NULL,
           freeze_binding_document_digest = NULL,
           freeze_binding_locked_at = NULL
       WHERE freeze_binding_tab_id = ?`,
      [tabId]
    );
  }
  testFailure("freeze-bindings", options);
}

async function deleteMessageRows(
  connection: PoolConnection,
  tabId: string,
  messageIds: string[],
  options: MysqlTabMessageMutationOptions
) {
  if (messageIds.length === 0) return 0;
  const placeholders = messageIds.map(() => "?").join(", ");
  await connection.execute<ResultSetHeader>(
    `DELETE FROM message_file_writes WHERE tab_id = ? AND message_id IN (${placeholders})`,
    [tabId, ...messageIds]
  );
  testFailure("message-file-writes", options);
  await releaseFreezeForDeletedMessages(connection, tabId, messageIds, options);
  await clearMessageReferences(connection, messageIds, options);
  const [deleted] = await connection.execute<ResultSetHeader>(
    `DELETE FROM messages WHERE tab_id = ? AND id IN (${placeholders})`,
    [tabId, ...messageIds]
  );
  if (deleted.affectedRows !== messageIds.length) {
    throw new Error("消息删除未完成，历史已变化");
  }
  testFailure("messages", options);
  return deleted.affectedRows;
}

async function executeMessageMutation(
  tabId: string,
  userId: string,
  operationName: "delete-message" | "truncate-messages",
  mutation: MysqlTabMutationRequest,
  execute: (connection: PoolConnection) => Promise<StoredMutationResult>
): Promise<MysqlTabMessageMutationResult> {
  const started = await beginMysqlTabOperation({
    tabId,
    userId,
    operation: operationName,
    request: mutation,
  });
  if (started.kind === "not-found") {
    return { status: 404, body: { error: "标签页不存在或无权操作" } };
  }
  if (started.kind === "request-id-mismatch") {
    return { status: 409, body: { error: "请求标识已用于其他操作" } };
  }
  if (started.kind === "conflict") return conflict(started.currentVersion);
  if (started.kind === "replay") return replayOperation(started.operation);

  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const response = await execute(connection);
    const tabVersion = await completeMysqlTabOperationInTransaction(
      connection,
      started.operation,
      response
    );
    await connection.commit();
    return operationResult(response, tabVersion);
  } catch (error) {
    await connection.rollback();
    await failMysqlTabOperation(
      started.operation,
      error instanceof Error ? error.message : "消息变更失败"
    );
    throw error;
  } finally {
    connection.release();
  }
}

export async function deleteMysqlMessage({
  tabId,
  userId,
  messageId,
  mutation,
  options = {},
}: {
  tabId: string;
  userId: string;
  messageId: string;
  mutation: MysqlTabMutationRequest;
  options?: MysqlTabMessageMutationOptions;
}): Promise<MysqlTabMessageMutationResult> {
  return executeMessageMutation(tabId, userId, "delete-message", mutation, async (connection) => {
    const [rows] = await connection.query<MysqlMessageRow[]>(
      "SELECT id, role FROM messages WHERE id = ? AND tab_id = ? FOR UPDATE",
      [messageId, tabId]
    );
    if (!rows[0]) {
      return { httpStatus: 404, body: { error: "消息不存在" } };
    }
    await deleteMessageRows(connection, tabId, [messageId], options);
    return { httpStatus: 200, body: { success: true } };
  });
}

export async function truncateMysqlMessages({
  tabId,
  userId,
  fromMessageId,
  mutation,
  options = {},
}: {
  tabId: string;
  userId: string;
  fromMessageId: string;
  mutation: MysqlTabMutationRequest;
  options?: MysqlTabMessageMutationOptions;
}): Promise<MysqlTabMessageMutationResult> {
  return executeMessageMutation(tabId, userId, "truncate-messages", mutation, async (connection) => {
    const [messages] = await connection.query<MysqlMessageRow[]>(
      "SELECT id, role FROM messages WHERE tab_id = ? ORDER BY timestamp ASC, id ASC FOR UPDATE",
      [tabId]
    );
    const targetIndex = messages.findIndex((message) => message.id === fromMessageId);
    if (targetIndex === -1) {
      return { httpStatus: 404, body: { error: "消息不存在" } };
    }
    if (messages[targetIndex].role !== "user") {
      return { httpStatus: 409, body: { error: "只能编辑用户消息" } };
    }
    const deletedCount = await deleteMessageRows(
      connection,
      tabId,
      messages.slice(targetIndex).map((message) => message.id),
      options
    );
    return { httpStatus: 200, body: { success: true, deletedCount } };
  });
}

async function lockOwnedTab(
  connection: PoolConnection,
  tabId: string,
  userId: string
): Promise<MysqlTab | null> {
  const [rows] = await connection.query<Array<MysqlTab & RowDataPacket>>(
    `SELECT t.id, t.work_record_id, t.agent_type, t.display_name, t.position, t.version,
            t.scope_frozen, t.freeze_status, t.freeze_message_id, t.freeze_filename,
            t.freeze_document_digest, t.freeze_error, t.active_operation_id, t.created_at
     FROM tabs t
     JOIN work_records w ON w.id = t.work_record_id
     JOIN projects p ON p.id = w.project_id
     WHERE t.id = ? AND p.user_id = ? FOR UPDATE`,
    [tabId, userId]
  );
  return rows[0] ? { ...rows[0], scope_frozen: Boolean(rows[0].scope_frozen) } : null;
}

async function deleteEntireTab(
  connection: PoolConnection,
  tabId: string,
  options: MysqlTabMessageMutationOptions
) {
  await connection.execute<ResultSetHeader>(
    "DELETE FROM agent_file_contexts WHERE tab_id = ?",
    [tabId]
  );
  testFailure("agent-file-contexts", options);
  await connection.execute<ResultSetHeader>(
    `UPDATE project_files
     SET freeze_binding_tab_id = NULL,
         freeze_binding_document_digest = NULL,
         freeze_binding_locked_at = NULL
     WHERE freeze_binding_tab_id = ?`,
    [tabId]
  );
  testFailure("freeze-bindings", options);

  const [messageRows] = await connection.query<Array<RowDataPacket & { id: string }>>(
    "SELECT id FROM messages WHERE tab_id = ? FOR UPDATE",
    [tabId]
  );
  const messageIds = messageRows.map((row) => row.id);
  await connection.execute<ResultSetHeader>(
    "DELETE FROM message_file_writes WHERE tab_id = ?",
    [tabId]
  );
  testFailure("message-file-writes", options);
  await clearMessageReferences(connection, messageIds, options);
  await connection.execute<ResultSetHeader>("DELETE FROM messages WHERE tab_id = ?", [tabId]);
  testFailure("messages", options);
  await connection.execute<ResultSetHeader>("DELETE FROM tab_operations WHERE tab_id = ?", [tabId]);
  testFailure("tab-operations", options);
  const [deleted] = await connection.execute<ResultSetHeader>("DELETE FROM tabs WHERE id = ?", [tabId]);
  if (deleted.affectedRows !== 1) throw new Error("标签页删除未完成");
  testFailure("tab", options);
}

function parseDeletedTabResponse(value: Record<string, unknown> | string): Record<string, unknown> | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function deleteMysqlTab({
  tabId,
  userId,
  mutation,
  options = {},
}: {
  tabId: string;
  userId: string;
  mutation: MysqlTabMutationRequest;
  options?: MysqlTabMessageMutationOptions;
}): Promise<MysqlTabMessageMutationResult> {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [tombstones] = await connection.query<MysqlDeletedTabOperationRow[]>(
      "SELECT user_id, response_json, tab_version FROM tab_deletion_operations WHERE tab_id = ? AND request_id = ? FOR UPDATE",
      [tabId, mutation.requestId]
    );
    const tombstone = tombstones[0];
    if (tombstone) {
      await connection.rollback();
      if (tombstone.user_id !== userId) {
        return { status: 404, body: { error: "标签页不存在或无权操作" } };
      }
      const response = parseDeletedTabResponse(tombstone.response_json);
      return response
        ? { status: 200, body: { ...response, tabVersion: tombstone.tab_version } }
        : { status: 500, body: { error: "删除结果已损坏，请联系管理员" } };
    }

    const tab = await lockOwnedTab(connection, tabId, userId);
    if (!tab) {
      await connection.rollback();
      return { status: 404, body: { error: "标签页不存在或无权操作" } };
    }
    const [operationRows] = await connection.query<Array<MysqlTabOperation & RowDataPacket>>(
      "SELECT id, tab_id, request_id, operation, expected_version, locked_version, status, response_json, tab_version FROM tab_operations WHERE tab_id = ? AND request_id = ? LIMIT 1 FOR UPDATE",
      [tabId, mutation.requestId]
    );
    const existing = operationRows[0];
    if (existing) {
      await connection.rollback();
      if (existing.operation !== "delete-tab") {
        return { status: 409, body: { error: "请求标识已用于其他操作" } };
      }
      return existing.status === "conflict"
        ? conflict(existing.tab_version)
        : { status: 409, body: { error: "请求正在处理中，请稍后重试" } };
    }
    if (tab.version !== mutation.expectedVersion || tab.active_operation_id) {
      await connection.execute<ResultSetHeader>(
        "INSERT INTO tab_operations (id, tab_id, request_id, operation, expected_version, status, tab_version) VALUES (?, ?, ?, 'delete-tab', ?, 'conflict', ?)",
        [randomUUID(), tabId, mutation.requestId, mutation.expectedVersion, tab.version]
      );
      await connection.commit();
      return conflict(tab.version);
    }

    const tabVersion = tab.version + 1;
    const [claimed] = await connection.execute<ResultSetHeader>(
      "UPDATE tabs SET version = ?, active_operation_id = ? WHERE id = ? AND version = ? AND active_operation_id IS NULL",
      [tabVersion, mutation.requestId, tabId, tab.version]
    );
    if (claimed.affectedRows !== 1) throw new Error("标签页并发状态异常，无法删除");
    await connection.execute<ResultSetHeader>(
      "INSERT INTO tab_operations (id, tab_id, request_id, operation, expected_version, locked_version, status, tab_version) VALUES (?, ?, ?, 'delete-tab', ?, ?, 'processing', ?)",
      [randomUUID(), tabId, mutation.requestId, mutation.expectedVersion, tabVersion, tabVersion]
    );
    const response = { success: true };
    await connection.execute<ResultSetHeader>(
      "INSERT INTO tab_deletion_operations (tab_id, request_id, user_id, response_json, tab_version) VALUES (?, ?, ?, ?, ?)",
      [tabId, mutation.requestId, userId, JSON.stringify(response), tabVersion]
    );
    await deleteEntireTab(connection, tabId, options);
    await connection.commit();
    return { status: 200, body: { ...response, tabVersion } };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
