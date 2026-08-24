import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { FreezeStatus } from "@/lib/agent-constants";
import { freezeDocumentDigest } from "@/lib/freeze-document-digest";
import { stripChangelogHeader } from "@/lib/file-helpers";
import { getMysqlPool } from "@/lib/mysql";
import type { MysqlTab } from "@/lib/mysql-account-workspace";
import {
  completeMysqlTabOperationInTransaction,
  failMysqlTabOperationInTransaction,
  type MysqlTabOperation,
} from "@/lib/mysql-tab-concurrency";

export interface MysqlFreezeState {
  version: number;
  scopeFrozen: boolean;
  freezeStatus: FreezeStatus;
  freezeMessageId?: string;
  freezeFilename?: string;
  freezeDocumentDigest?: string;
  freezeError?: string;
}

function stateFromTab(tab: MysqlTab): MysqlFreezeState {
  const scopeFrozen = Boolean(tab.scope_frozen);
  return {
    version: Number(tab.version),
    scopeFrozen,
    freezeStatus: scopeFrozen ? "frozen" : tab.freeze_status,
    ...(tab.freeze_message_id ? { freezeMessageId: tab.freeze_message_id } : {}),
    ...(tab.freeze_filename ? { freezeFilename: tab.freeze_filename } : {}),
    ...(tab.freeze_document_digest ? { freezeDocumentDigest: tab.freeze_document_digest } : {}),
    ...(tab.freeze_error ? { freezeError: tab.freeze_error } : {}),
  };
}

export function mysqlFreezeStateFromTab(tab: MysqlTab): MysqlFreezeState {
  return stateFromTab(tab);
}

export async function setMysqlFreezeGenerating(connection: PoolConnection, input: {
  tabId: string;
  requestId: string;
  messageId: string;
}) {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE tabs
     SET freeze_status = 'generating', freeze_message_id = ?, freeze_filename = NULL,
         freeze_document_digest = NULL, freeze_error = NULL
     WHERE id = ? AND active_operation_id = ? AND scope_frozen = FALSE
       AND freeze_status IN ('proposed', 'failed')`,
    [input.messageId, input.tabId, input.requestId]
  );
  if (result.affectedRows !== 1) throw new Error("冻结状态已变化，无法开始生成");
}

export async function markMysqlFreezeProposed(input: { tabId: string; requestId: string }) {
  await getMysqlPool().execute<ResultSetHeader>(
    `UPDATE tabs
     SET freeze_status = 'proposed', freeze_message_id = NULL, freeze_filename = NULL,
         freeze_document_digest = NULL, freeze_error = NULL
     WHERE id = ? AND active_operation_id = ? AND scope_frozen = FALSE
       AND freeze_status IN ('idle', 'proposed', 'failed')`,
    [input.tabId, input.requestId]
  );
}

export async function completeMysqlFreezeGeneration(input: {
  tabId: string;
  requestId: string;
  messageId: string;
  content: string;
  documentContent: string;
  filename: string;
  operation: MysqlTabOperation;
}) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [message] = await connection.execute<ResultSetHeader>(
      "UPDATE messages SET content = ?, status = 'completed', error_message = NULL WHERE id = ? AND tab_id = ? AND status = 'generating'",
      [input.content, input.messageId, input.tabId]
    );
    if (message.affectedRows !== 1) throw new Error("生成消息状态已变化");
    const [tab] = await connection.execute<ResultSetHeader>(
      `UPDATE tabs
       SET freeze_status = 'awaiting_write', freeze_filename = ?, freeze_document_digest = ?, freeze_error = NULL
       WHERE id = ? AND active_operation_id = ? AND freeze_status = 'generating'
         AND freeze_message_id = ? AND scope_frozen = FALSE`,
      [input.filename, freezeDocumentDigest(input.documentContent), input.tabId, input.requestId, input.messageId]
    );
    if (tab.affectedRows !== 1) throw new Error("冻结状态更新失败");
    const tabVersion = await completeMysqlTabOperationInTransaction(
      connection,
      input.operation,
      { messageId: input.messageId }
    );
    await connection.commit();
    return { tabVersion };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function failMysqlFreezeGeneration(input: {
  tabId: string;
  requestId: string;
  messageId: string;
  content: string;
  status: "failed" | "interrupted";
  errorMessage: string;
  operation: MysqlTabOperation;
}) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute<ResultSetHeader>(
      "UPDATE messages SET content = ?, status = ?, error_message = ? WHERE id = ? AND tab_id = ? AND status = 'generating'",
      [input.content, input.status, input.errorMessage, input.messageId, input.tabId]
    );
    await connection.execute<ResultSetHeader>(
      `UPDATE tabs
       SET freeze_status = 'failed', freeze_message_id = ?, freeze_filename = NULL,
           freeze_document_digest = NULL, freeze_error = ?
       WHERE id = ? AND active_operation_id = ? AND scope_frozen = FALSE`,
      [input.messageId, input.errorMessage, input.tabId, input.requestId]
    );
    const tabVersion = await failMysqlTabOperationInTransaction(
      connection,
      input.operation,
      input.errorMessage
    );
    await connection.commit();
    return { tabVersion };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

type OwnedFreezeRow = RowDataPacket & MysqlTab & { project_id: string };

export type MysqlFreezeActionResult =
  | { kind: "not-found" }
  | { kind: "invalid-state" }
  | { kind: "missing-document" }
  | { kind: "mismatched-document" }
  | { kind: "binding-conflict" }
  | { kind: "completed"; freezeStatus: "frozen" | "proposed"; scopeFrozen: boolean; tabVersion: number };

export async function performMysqlFreezeAction(input: {
  tabId: string;
  userId: string;
  action: "complete" | "cancel";
  operation: MysqlTabOperation;
}): Promise<MysqlFreezeActionResult> {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [tabRows] = await connection.query<OwnedFreezeRow[]>(
      `SELECT t.id, t.work_record_id, t.agent_type, t.display_name, t.position, t.version, t.scope_frozen,
              t.freeze_status, t.freeze_message_id, t.freeze_filename, t.freeze_document_digest, t.freeze_error,
              t.active_operation_id, t.created_at, w.project_id
       FROM tabs t
       JOIN work_records w ON w.id = t.work_record_id
       JOIN projects p ON p.id = w.project_id
       WHERE t.id = ? AND p.user_id = ? FOR UPDATE`,
      [input.tabId, input.userId]
    );
    const tab = tabRows[0];
    if (!tab) {
      await connection.rollback();
      return { kind: "not-found" };
    }
    if (tab.scope_frozen || tab.freeze_status !== "awaiting_write") {
      await connection.rollback();
      return { kind: "invalid-state" };
    }
    if (input.action === "cancel") {
      await connection.execute<ResultSetHeader>(
        `UPDATE tabs
         SET scope_frozen = FALSE, freeze_status = 'proposed', freeze_message_id = NULL,
             freeze_filename = NULL, freeze_document_digest = NULL, freeze_error = NULL
         WHERE id = ? AND active_operation_id = ?`,
        [input.tabId, input.operation.request_id]
      );
      const response = { freezeStatus: "proposed" as const, scopeFrozen: false };
      const tabVersion = await completeMysqlTabOperationInTransaction(connection, input.operation, response);
      await connection.commit();
      return { kind: "completed", ...response, tabVersion };
    }
    if (!tab.freeze_filename || !tab.freeze_document_digest) {
      await connection.rollback();
      return { kind: "missing-document" };
    }
    const [fileRows] = await connection.query<Array<RowDataPacket & { id: string; content: string; freeze_binding_tab_id: string | null }>>(
      "SELECT id, content, freeze_binding_tab_id FROM project_files WHERE project_id = ? AND filename = ? FOR UPDATE",
      [tab.project_id, tab.freeze_filename]
    );
    const file = fileRows[0];
    if (!file) {
      await connection.rollback();
      return { kind: "missing-document" };
    }
    if (freezeDocumentDigest(stripChangelogHeader(file.content)) !== tab.freeze_document_digest) {
      await connection.rollback();
      return { kind: "mismatched-document" };
    }
    if (file.freeze_binding_tab_id && file.freeze_binding_tab_id !== tab.id) {
      await connection.rollback();
      return { kind: "binding-conflict" };
    }
    const [bound] = await connection.execute<ResultSetHeader>(
      `UPDATE project_files
       SET freeze_binding_tab_id = ?, freeze_binding_document_digest = ?, freeze_binding_locked_at = ?
       WHERE id = ? AND freeze_binding_tab_id IS NULL`,
      [tab.id, tab.freeze_document_digest, new Date(), file.id]
    );
    if (bound.affectedRows !== 1) {
      await connection.rollback();
      return { kind: "binding-conflict" };
    }
    const [frozen] = await connection.execute<ResultSetHeader>(
      `UPDATE tabs SET scope_frozen = TRUE, freeze_status = 'frozen', freeze_error = NULL
       WHERE id = ? AND active_operation_id = ? AND freeze_status = 'awaiting_write' AND scope_frozen = FALSE`,
      [tab.id, input.operation.request_id]
    );
    if (frozen.affectedRows !== 1) throw new Error("冻结状态更新失败");
    const response = { freezeStatus: "frozen" as const, scopeFrozen: true };
    const tabVersion = await completeMysqlTabOperationInTransaction(connection, input.operation, response);
    await connection.commit();
    return { kind: "completed", ...response, tabVersion };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
