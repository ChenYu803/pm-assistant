import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { AgentType } from "@/lib/agent-constants";
import type {
  AssistantMessageStatus,
  MessageReplacementKind,
} from "@/lib/message-types";
import { getMysqlPool } from "@/lib/mysql";
import type { MysqlTab } from "@/lib/mysql-account-workspace";

export type MysqlAssistantStatus = AssistantMessageStatus;
export type MysqlReplacementKind = MessageReplacementKind;

export interface MysqlMessage {
  id: string;
  tab_id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  status: MysqlAssistantStatus | null;
  error_message: string | null;
  request_id: string | null;
  replacement_target_id: string | null;
  replacement_commit_message_id: string | null;
  superseded_by_message_id: string | null;
  replacement_committed: boolean;
  replacement_kind: MysqlReplacementKind | null;
  replacement_user_message_id: string | null;
  file_provenance_version: number | null;
}

export interface MysqlConversationTab extends MysqlTab {
  project_id: string;
}

const MESSAGE_COLUMNS = "id, tab_id, role, content, timestamp, status, error_message, request_id, replacement_target_id, replacement_commit_message_id, superseded_by_message_id, replacement_committed, replacement_kind, replacement_user_message_id, file_provenance_version";

function mapMessage(message: MysqlMessage): MysqlMessage {
  return { ...message, replacement_committed: Boolean(message.replacement_committed) };
}

export async function findOwnedMysqlConversationTab(tabId: string, userId: string): Promise<MysqlConversationTab | null> {
  const [rows] = await getMysqlPool().query<MysqlConversationTab[]>(
    `SELECT t.id, t.work_record_id, t.agent_type, t.display_name, t.position, t.version, t.scope_frozen, t.freeze_status, t.freeze_message_id, t.freeze_filename, t.freeze_document_digest, t.freeze_error, t.active_operation_id, t.created_at, w.project_id
     FROM tabs t
     JOIN work_records w ON w.id = t.work_record_id
     JOIN projects p ON p.id = w.project_id
     WHERE t.id = ? AND p.user_id = ? LIMIT 1`,
    [tabId, userId]
  );
  return rows[0] ? { ...rows[0], scope_frozen: Boolean(rows[0].scope_frozen) } : null;
}

export async function listMysqlMessages(tabId: string): Promise<MysqlMessage[]> {
  const [rows] = await getMysqlPool().query<Array<MysqlMessage & RowDataPacket>>(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE tab_id = ? ORDER BY timestamp ASC, id ASC`,
    [tabId]
  );
  return rows.map(mapMessage);
}

export function getVisibleMysqlMessages(messages: MysqlMessage[]): MysqlMessage[] {
  const committed = new Set(messages.filter((message) => message.replacement_committed).map((message) => message.id));
  return messages.filter((message) => {
    if (message.superseded_by_message_id && committed.has(message.superseded_by_message_id)) return false;
    if (message.replacement_commit_message_id && !committed.has(message.replacement_commit_message_id)) return false;
    return !(
      message.role === "assistant" &&
      message.replacement_target_id &&
      message.status === "completed" &&
      !message.replacement_committed
    );
  });
}

export async function findMysqlMessageByRequest(tabId: string, requestId: string): Promise<MysqlMessage | null> {
  const [rows] = await getMysqlPool().query<Array<MysqlMessage & RowDataPacket>>(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE tab_id = ? AND request_id = ? LIMIT 1`,
    [tabId, requestId]
  );
  return rows[0] ? mapMessage(rows[0]) : null;
}

export async function createMysqlAssistantMessage(input: {
  tabId: string;
  requestId: string;
  timestamp: Date;
  replacementTargetId?: string;
  replacementKind?: MysqlReplacementKind;
}): Promise<MysqlMessage> {
  const message: MysqlMessage = {
    id: randomUUID(), tab_id: input.tabId, role: "assistant", content: "", timestamp: input.timestamp,
    status: "generating", error_message: null, request_id: input.requestId,
    replacement_target_id: input.replacementTargetId ?? null, replacement_commit_message_id: null,
    superseded_by_message_id: null, replacement_committed: false,
    replacement_kind: input.replacementKind ?? null, replacement_user_message_id: null,
    file_provenance_version: 1,
  };
  await getMysqlPool().execute<ResultSetHeader>(
    `INSERT INTO messages (${MESSAGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [message.id, message.tab_id, message.role, message.content, message.timestamp, message.status, message.error_message, message.request_id, message.replacement_target_id, message.replacement_commit_message_id, message.superseded_by_message_id, message.replacement_committed, message.replacement_kind, message.replacement_user_message_id, message.file_provenance_version]
  );
  return message;
}

export async function createMysqlChatStart(connection: PoolConnection, input: {
  tabId: string;
  requestId: string;
  timestamp: Date;
  replacementTargetId?: string;
  replacementKind?: MysqlReplacementKind;
  userContent?: string;
  replacementUserContent?: string;
}) {
  const assistant: MysqlMessage = {
    id: randomUUID(), tab_id: input.tabId, role: "assistant", content: "", timestamp: input.timestamp,
    status: "generating", error_message: null, request_id: input.requestId,
    replacement_target_id: input.replacementTargetId ?? null, replacement_commit_message_id: null,
    superseded_by_message_id: null, replacement_committed: false,
    replacement_kind: input.replacementKind ?? null, replacement_user_message_id: null,
    file_provenance_version: 1,
  };
  await connection.execute<ResultSetHeader>(
    `INSERT INTO messages (${MESSAGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [assistant.id, assistant.tab_id, assistant.role, assistant.content, assistant.timestamp, assistant.status, assistant.error_message, assistant.request_id, assistant.replacement_target_id, assistant.replacement_commit_message_id, assistant.superseded_by_message_id, assistant.replacement_committed, assistant.replacement_kind, assistant.replacement_user_message_id, assistant.file_provenance_version]
  );
  const content = input.replacementUserContent ?? input.userContent;
  if (content === undefined) return { assistant, userMessage: undefined };
  const userMessage = { id: randomUUID(), role: "user" as const, content, timestamp: new Date(input.timestamp.getTime() - 1) };
  await connection.execute<ResultSetHeader>(
    "INSERT INTO messages (id, tab_id, role, content, timestamp, replacement_commit_message_id) VALUES (?, ?, 'user', ?, ?, ?)",
    [userMessage.id, input.tabId, userMessage.content, userMessage.timestamp, input.replacementUserContent ? assistant.id : null]
  );
  if (input.replacementUserContent) {
    await connection.execute<ResultSetHeader>(
      "UPDATE messages SET replacement_user_message_id = ? WHERE id = ? AND role = 'assistant'",
      [userMessage.id, assistant.id]
    );
  }
  return { assistant, userMessage };
}

export async function createMysqlUserMessage(input: { tabId: string; content: string; timestamp: Date; replacementCommitMessageId?: string }) {
  const message = { id: randomUUID(), ...input };
  await getMysqlPool().execute<ResultSetHeader>(
    "INSERT INTO messages (id, tab_id, role, content, timestamp, replacement_commit_message_id) VALUES (?, ?, 'user', ?, ?, ?)",
    [message.id, message.tabId, message.content, message.timestamp, message.replacementCommitMessageId ?? null]
  );
  return { id: message.id, role: "user" as const, content: message.content, timestamp: message.timestamp };
}

export async function attachMysqlReplacementUser(assistantId: string, userId: string) {
  await getMysqlPool().execute<ResultSetHeader>(
    "UPDATE messages SET replacement_user_message_id = ? WHERE id = ? AND role = 'assistant'",
    [userId, assistantId]
  );
}

export async function updateMysqlGeneratingMessage(messageId: string, tabId: string, content: string) {
  const [result] = await getMysqlPool().execute<ResultSetHeader>(
    "UPDATE messages SET content = ? WHERE id = ? AND tab_id = ? AND status = 'generating'",
    [content, messageId, tabId]
  );
  return result.affectedRows === 1;
}

export async function failMysqlGeneratingMessage(messageId: string, tabId: string, content: string, status: "failed" | "interrupted", errorMessage: string) {
  const [result] = await getMysqlPool().execute<ResultSetHeader>(
    "UPDATE messages SET content = ?, status = ?, error_message = ? WHERE id = ? AND tab_id = ? AND status = 'generating'",
    [content, status, errorMessage, messageId, tabId]
  );
  if (result.affectedRows === 1) return getMysqlMessage(messageId);
  return getMysqlMessage(messageId);
}

export async function getMysqlMessage(messageId: string): Promise<MysqlMessage | null> {
  const [rows] = await getMysqlPool().query<Array<MysqlMessage & RowDataPacket>>(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ? LIMIT 1`,
    [messageId]
  );
  return rows[0] ? mapMessage(rows[0]) : null;
}

export async function completeMysqlMessage(input: { messageId: string; tabId: string; content: string; supersedeIds: string[] }) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [completed] = await connection.execute<ResultSetHeader>(
      "UPDATE messages SET content = ?, status = 'completed', error_message = NULL WHERE id = ? AND tab_id = ? AND status = 'generating'",
      [input.content, input.messageId, input.tabId]
    );
    if (completed.affectedRows !== 1) throw new Error("生成消息状态已变化");
    if (input.supersedeIds.length > 0) {
      const placeholders = input.supersedeIds.map(() => "?").join(", ");
      const [superseded] = await connection.execute<ResultSetHeader>(
        `UPDATE messages SET superseded_by_message_id = ? WHERE tab_id = ? AND id IN (${placeholders}) AND superseded_by_message_id IS NULL`,
        [input.messageId, input.tabId, ...input.supersedeIds]
      );
      if (superseded.affectedRows !== input.supersedeIds.length) throw new Error("待替换历史已变化，未提交新结果");
      const [committed] = await connection.execute<ResultSetHeader>(
        "UPDATE messages SET replacement_committed = TRUE WHERE id = ? AND tab_id = ? AND status = 'completed' AND replacement_committed = FALSE",
        [input.messageId, input.tabId]
      );
      if (committed.affectedRows !== 1) throw new Error("新结果替换提交失败");
    }
    await connection.commit();
    const message = await getMysqlMessage(input.messageId);
    if (!message) throw new Error("完成的消息不存在");
    return message;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function stopMysqlGeneratingMessage(tabId: string, messageId: string) {
  const [result] = await getMysqlPool().execute<ResultSetHeader>(
    "UPDATE messages SET status = 'interrupted', error_message = '生成已停止' WHERE id = ? AND tab_id = ? AND role = 'assistant' AND status = 'generating'",
    [messageId, tabId]
  );
  return result.affectedRows === 1 ? getMysqlMessage(messageId) : null;
}

export async function applyMysqlAutomaticWorkRecordName(workRecordId: string, name: string): Promise<string | null> {
  const [result] = await getMysqlPool().execute<ResultSetHeader>(
    "UPDATE work_records SET name = ? WHERE id = ? AND name = '未命名'",
    [name, workRecordId]
  );
  return result.affectedRows === 1 ? name : null;
}

export async function mysqlMessageCount(tabId: string) {
  const [rows] = await getMysqlPool().query<Array<RowDataPacket & { count: number }>>(
    "SELECT COUNT(*) AS count FROM messages WHERE tab_id = ?", [tabId]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function mysqlConversationForAutoName(tabId: string) {
  const [rows] = await getMysqlPool().query<Array<MysqlMessage & RowDataPacket>>(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE tab_id = ? ORDER BY timestamp ASC, id ASC LIMIT 20`, [tabId]
  );
  return rows.map(mapMessage);
}

export function mysqlAgentType(tab: MysqlConversationTab): AgentType {
  return tab.agent_type;
}
