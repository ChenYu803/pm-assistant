import { NextResponse } from "next/server";

import { cancelGeneration } from "@/lib/generation-control";
import {
  findOwnedMysqlConversationTab,
  getVisibleMysqlMessages,
  listMysqlMessages,
  stopMysqlGeneratingMessage,
} from "@/lib/mysql-conversation";
import {
  beginMysqlTabOperation,
  completeMysqlTabOperation,
  MYSQL_TAB_CONFLICT_MESSAGE,
  parseMysqlTabMutationRequest,
  waitForMysqlTabOperation,
} from "@/lib/mysql-tab-concurrency";
import { listMysqlMessageFileWrites } from "@/lib/mysql-project-artifacts";

function conflict(currentVersion: number | null) {
  return NextResponse.json({ error: MYSQL_TAB_CONFLICT_MESSAGE, code: "TAB_VERSION_CONFLICT", currentVersion }, { status: 409 });
}

export async function getMysqlMessagesRoute(tabId: string, userId: string) {
  const tab = await findOwnedMysqlConversationTab(tabId, userId);
  if (!tab) return NextResponse.json({ error: "标签页不存在或无权访问" }, { status: 404 });
  const messages = getVisibleMysqlMessages(await listMysqlMessages(tabId));
  const writes = await listMysqlMessageFileWrites(messages.map((message) => message.id));
  const writesByMessage = new Map<string, typeof writes>();
  for (const write of writes) {
    const key = write.message_id;
    writesByMessage.set(key, [...(writesByMessage.get(key) ?? []), write]);
  }
  return NextResponse.json({
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      ...(message.role === "assistant" ? {
        status: message.status ?? "completed",
        ...(message.error_message ? { errorMessage: message.error_message } : {}),
        fileProvenance: {
          tracked: typeof message.file_provenance_version === "number",
          writes: (writesByMessage.get(message.id) ?? []).map((write) => ({ id: write.id, filename: write.filename, operation: write.operation, fileVersion: Number(write.file_version), messageStatus: write.message_status, writeStatus: write.write_status, writtenAt: write.written_at })),
        },
      } : {}),
      ...(message.replacement_target_id ? { replacesMessageId: message.replacement_target_id } : {}),
      ...(message.replacement_kind ? { replacementKind: message.replacement_kind } : {}),
    })),
    tabVersion: tab.version,
    freezeStatus: tab.freeze_status,
    scopeFrozen: tab.scope_frozen,
    ...(tab.freeze_message_id ? { freezeMessageId: tab.freeze_message_id } : {}),
    ...(tab.freeze_error ? { freezeError: tab.freeze_error } : {}),
  });
}

export async function stopMysqlMessageRoute(tabId: string, userId: string, body: Record<string, unknown>, request: Request) {
  const messageId = typeof body.messageId === "string" ? body.messageId : new URL(request.url).searchParams.get("messageId");
  const mutation = parseMysqlTabMutationRequest(body);
  if (!mutation) return NextResponse.json({ error: "并发请求参数无效" }, { status: 400 });
  if (!messageId) return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  const started = await beginMysqlTabOperation({ tabId, userId, operation: "stop-generation", request: mutation, passive: true });
  if (started.kind === "not-found") return NextResponse.json({ error: "标签页不存在或无权操作" }, { status: 404 });
  if (started.kind === "request-id-mismatch") return NextResponse.json({ error: "请求标识已用于其他操作" }, { status: 409 });
  if (started.kind === "conflict") return conflict(started.currentVersion);
  if (started.kind === "replay") {
    const replay = await waitForMysqlTabOperation(started.operation);
    if (replay.status === "conflict") return conflict(replay.tab_version);
    const response = typeof replay.response_json === "object" && replay.response_json ? replay.response_json : null;
    return response ? NextResponse.json({ ...response, tabVersion: replay.tab_version }) : NextResponse.json({ error: "请求正在处理中，请稍后重试" }, { status: 409 });
  }
  const message = await stopMysqlGeneratingMessage(tabId, messageId);
  const tabVersion = await completeMysqlTabOperation(started.operation, message ? {
    message: { id: message.id, role: message.role, content: message.content, timestamp: message.timestamp, status: message.status, errorMessage: message.error_message },
  } : { error: "消息不是生成中状态，无法停止" });
  if (!message) return NextResponse.json({ error: "消息不是生成中状态，无法停止", tabVersion }, { status: 409 });
  cancelGeneration(message.id);
  return NextResponse.json({ message: { id: message.id, role: message.role, content: message.content, timestamp: message.timestamp, status: message.status, errorMessage: message.error_message }, tabVersion });
}
