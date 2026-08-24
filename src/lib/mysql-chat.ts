import { NextResponse } from "next/server";

import { AGENT_SYSTEM_PROMPTS } from "@/lib/agent-prompts";
import { createAIStream, isAIConfigured, type AIMessage } from "@/lib/ai";
import {
  attachMysqlReplacementUser,
  completeMysqlMessage,
  createMysqlAssistantMessage,
  createMysqlUserMessage,
  failMysqlGeneratingMessage,
  findMysqlMessageByRequest,
  getVisibleMysqlMessages,
  listMysqlMessages,
  type MysqlMessage,
  type MysqlReplacementKind,
  updateMysqlGeneratingMessage,
} from "@/lib/mysql-conversation";
import {
  beginMysqlTabOperation,
  completeMysqlTabOperation,
  failMysqlTabOperation,
  MYSQL_TAB_CONFLICT_MESSAGE,
  parseMysqlTabMutationRequest,
  waitForMysqlTabOperation,
} from "@/lib/mysql-tab-concurrency";
import { registerGeneration, releaseGeneration } from "@/lib/generation-control";

class MysqlGenerationInterruptedError extends Error {
  constructor() {
    super("生成已停止");
  }
}

const encoder = new TextEncoder();

function sse(type: string, data: Record<string, unknown>) {
  return encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

function send(controller: ReadableStreamDefaultController<Uint8Array>, type: string, data: Record<string, unknown>) {
  if (controller.desiredSize === null) return;
  try {
    controller.enqueue(sse(type, data));
  } catch (error) {
    if (!(error instanceof TypeError && error.message.includes("already closed"))) throw error;
  }
}

function close(controller: ReadableStreamDefaultController<Uint8Array>) {
  if (controller.desiredSize === null) return;
  try {
    controller.close();
  } catch (error) {
    if (!(error instanceof TypeError && error.message.includes("already closed"))) throw error;
  }
}

function messageJson(message: MysqlMessage) {
  return {
    messageId: message.id,
    content: message.content,
    status: message.status ?? "completed",
    timestamp: message.timestamp.toISOString(),
    ...(message.error_message ? { errorMessage: message.error_message } : {}),
    ...(message.replacement_target_id ? { replacesMessageId: message.replacement_target_id } : {}),
    ...(message.replacement_kind ? { replacementKind: message.replacement_kind } : {}),
  };
}

function replayMysqlRequest(existing: MysqlMessage, tabVersion?: number) {
  const stream = new ReadableStream({
    start(controller) {
      send(controller, "start", { ...messageJson(existing), ...(tabVersion === undefined ? {} : { tabVersion }) });
      if (existing.status !== "generating") {
        send(controller, existing.status === "completed" ? "done" : "error", {
          ...messageJson(existing), ...(tabVersion === undefined ? {} : { tabVersion }),
        });
      }
      close(controller);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}

function conflict(currentVersion: number | null) {
  return NextResponse.json({ error: MYSQL_TAB_CONFLICT_MESSAGE, code: "TAB_VERSION_CONFLICT", currentVersion }, { status: 409 });
}

export async function postMysqlChat({ request, userId, tabId, body }: { request: Request; userId: string; tabId: string; body: Record<string, unknown> }) {
  const { content, regenerate, messageId, editMessageId, retryMessageId, freeze } = body;
  const mutation = parseMysqlTabMutationRequest(body);
  const isRegenerate = regenerate === true;
  const isEdit = typeof editMessageId === "string";
  const isRetry = typeof retryMessageId === "string";
  const isFreeze = freeze === true;
  const operationCount = Number(isRegenerate) + Number(isEdit) + Number(isRetry) + Number(isFreeze);
  if (
    operationCount > 1 ||
    ((!isRegenerate && !isRetry && !isFreeze) && (typeof content !== "string" || !content.trim())) ||
    (isRegenerate && typeof messageId !== "string") ||
    !mutation
  ) return NextResponse.json({ error: isRegenerate || isEdit || isRetry || isFreeze ? "生成请求参数无效" : "消息内容不能为空" }, { status: 400 });
  if (isFreeze) return NextResponse.json({ error: "冻结流程尚未迁移完成" }, { status: 409 });
  if (!isAIConfigured()) return NextResponse.json({ error: "AI 服务未配置，请联系管理员设置 AI_API_KEY" }, { status: 500 });

  const existing = await findMysqlMessageByRequest(tabId, mutation.requestId);
  if (existing) return replayMysqlRequest(existing);
  const operationStart = await beginMysqlTabOperation({ tabId, userId, operation: "chat", request: mutation });
  if (operationStart.kind === "not-found") return NextResponse.json({ error: "标签页不存在或无权操作" }, { status: 404 });
  if (operationStart.kind === "request-id-mismatch") return NextResponse.json({ error: "请求标识已用于其他操作" }, { status: 409 });
  if (operationStart.kind === "conflict") return conflict(operationStart.currentVersion);
  if (operationStart.kind === "replay") {
    const replay = await waitForMysqlTabOperation(operationStart.operation);
    const saved = typeof replay.response_json === "object" && replay.response_json ? replay.response_json : {};
    const replayId = typeof saved.messageId === "string" ? saved.messageId : undefined;
    if (replayId) {
      const message = await findMysqlMessageByRequest(tabId, mutation.requestId);
      if (message) return replayMysqlRequest(message, replay.tab_version ?? undefined);
    }
    return replay.status === "conflict" ? conflict(replay.tab_version) : NextResponse.json({ error: "请求正在处理中，请稍后重试" }, { status: 409 });
  }

  const tab = operationStart.tab;
  const operation = operationStart.operation;
  const allMessages = await listMysqlMessages(tabId);
  const visible = getVisibleMysqlMessages(allMessages);
  let history = visible;
  let replacementKind: MysqlReplacementKind | undefined;
  let replacementTargetId: string | undefined;
  let supersedeIds: string[] = [];
  let replacementUserContent: string | undefined;

  if (isRegenerate) {
    const targetIndex = visible.findIndex((message) => message.id === messageId);
    const target = visible[targetIndex];
    const hasLaterUsable = visible.slice(targetIndex + 1).some((message) => message.role === "user" || (message.role === "assistant" && message.status === "completed"));
    if (!target || target.role !== "assistant" || target.status !== "completed" || hasLaterUsable) {
      await failMysqlTabOperation(operation, "只能重新输出最后一条已完成的 AI 回复");
      return NextResponse.json({ error: "只能重新输出最后一条已完成的 AI 回复" }, { status: 409 });
    }
    replacementKind = "regenerate";
    replacementTargetId = target.id;
    supersedeIds = visible.slice(targetIndex).map((message) => message.id);
    history = visible.slice(0, targetIndex);
  } else if (isEdit) {
    const targetIndex = visible.findIndex((message) => message.id === editMessageId);
    const target = visible[targetIndex];
    if (!target || target.role !== "user" || typeof content !== "string" || !content.trim()) {
      await failMysqlTabOperation(operation, "只能编辑当前可见的用户消息");
      return NextResponse.json({ error: "只能编辑当前可见的用户消息" }, { status: 409 });
    }
    replacementKind = "edit";
    replacementTargetId = target.id;
    supersedeIds = visible.slice(targetIndex).map((message) => message.id);
    replacementUserContent = content.trim();
    history = visible.slice(0, targetIndex);
  } else if (isRetry) {
    const previous = visible.find((message) => message.id === retryMessageId);
    if (!previous || previous.role !== "assistant" || !["failed", "interrupted"].includes(previous.status ?? "completed")) {
      await failMysqlTabOperation(operation, "只能重试失败或中断的生成");
      return NextResponse.json({ error: "只能重试失败或中断的生成" }, { status: 409 });
    }
    replacementKind = previous.replacement_kind ?? "retry";
    replacementTargetId = previous.replacement_target_id ?? previous.id;
    const targetIndex = visible.findIndex((message) => message.id === replacementTargetId);
    if (targetIndex === -1) {
      await failMysqlTabOperation(operation, "重试的原消息已不存在");
      return NextResponse.json({ error: "重试的原消息已不存在" }, { status: 409 });
    }
    supersedeIds = visible.slice(targetIndex).map((message) => message.id);
    history = visible.slice(0, targetIndex);
    if (replacementKind === "edit") {
      const edited = allMessages.find((message) => message.id === previous.replacement_user_message_id);
      if (!edited || edited.role !== "user") {
        await failMysqlTabOperation(operation, "编辑重发的重试上下文已失效");
        return NextResponse.json({ error: "编辑重发的重试上下文已失效" }, { status: 409 });
      }
      replacementUserContent = edited.content;
    }
  }

  const prompt = `${AGENT_SYSTEM_PROMPTS[tab.agent_type]}${(tab.agent_type === "requirement_analyst" || tab.agent_type === "mvp_prd") ? `\n\n## 当前标签页\n\n当前标签页名称：${tab.display_name}。` : ""}`;
  const usableHistory = history.filter((message) => message.role !== "assistant" || message.status === "completed");
  const appendUser = !isRegenerate && !isRetry;
  const userContent = replacementUserContent ?? (typeof content === "string" ? content.trim() : "");
  const messages: AIMessage[] = [
    { role: "system", content: prompt },
    ...usableHistory.map((message) => ({ role: message.role, content: message.content }) as AIMessage),
    ...(appendUser ? [{ role: "user" as const, content: userContent }] : []),
  ];

  const timestamp = new Date();
  let assistant: MysqlMessage;
  try {
    assistant = await createMysqlAssistantMessage({ tabId, requestId: mutation.requestId, timestamp, replacementTargetId, replacementKind });
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
    if (!duplicate) {
      await failMysqlTabOperation(operation, error instanceof Error ? error.message : "创建生成消息失败");
      throw error;
    }
    const saved = await findMysqlMessageByRequest(tabId, mutation.requestId);
    if (saved) return replayMysqlRequest(saved, operation.locked_version ?? undefined);
    throw error;
  }
  let userMessage: { id: string; role: "user"; content: string; timestamp: Date } | undefined;
  try {
    if (!isRegenerate && !isEdit && !isRetry) userMessage = await createMysqlUserMessage({ tabId, content: userContent, timestamp: new Date(timestamp.getTime() - 1) });
    if (replacementKind === "edit" && replacementUserContent) {
      userMessage = await createMysqlUserMessage({ tabId, content: replacementUserContent, timestamp: new Date(timestamp.getTime() - 1), replacementCommitMessageId: assistant.id });
      await attachMysqlReplacementUser(assistant.id, userMessage.id);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "创建消息记录失败";
    await failMysqlGeneratingMessage(assistant.id, tabId, "", "failed", errorMessage);
    const tabVersion = await failMysqlTabOperation(operation, errorMessage);
    return NextResponse.json({ error: errorMessage, tabVersion }, { status: 500 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      let fullContent = "";
      let operationFinished = false;
      const generation = registerGeneration(assistant.id);
      send(controller, "start", { ...messageJson(assistant), ...(userMessage ? { userMessageId: userMessage.id } : {}), tabVersion: operation.locked_version });
      try {
        const failureMode = process.env.NODE_ENV !== "production" ? request.headers.get("x-pm-verify-force-error") : null;
        if (failureMode === "zero-token") throw new Error("回放强制零 token 失败");
        const stream = await createAIStream({ agentType: tab.agent_type, maxTokens: 32768, messages, timeoutMs: 600_000, signal: generation.signal, replayDelayMs: process.env.NODE_ENV !== "production" && request.headers.get("x-pm-verify-stream-delay") === "1" ? 300 : undefined });
        for await (const chunk of stream) {
          if (generation.signal.aborted) throw new MysqlGenerationInterruptedError();
          const delta = chunk.choices[0]?.delta?.content;
          if (!delta) continue;
          fullContent += delta;
          if (!(await updateMysqlGeneratingMessage(assistant.id, tabId, fullContent))) throw new MysqlGenerationInterruptedError();
          send(controller, "token", { messageId: assistant.id, content: delta });
          if (failureMode === "after-token") throw new Error("回放强制 partial 失败");
        }
        const completed = await completeMysqlMessage({ messageId: assistant.id, tabId, content: fullContent, supersedeIds });
        const tabVersion = await completeMysqlTabOperation(operation, { messageId: assistant.id });
        operationFinished = true;
        send(controller, "done", { ...messageJson(completed), ...(userMessage ? { userMessageId: userMessage.id } : {}), ...(supersedeIds.length ? { replacesMessageIds: supersedeIds, replaceFromMessageId: replacementTargetId } : {}), tabVersion });
      } catch (error) {
        const interrupted = error instanceof MysqlGenerationInterruptedError || generation.signal.aborted;
        const errorMessage = interrupted ? "生成已停止" : error instanceof Error ? error.message : "AI 请求失败，请稍后重试";
        const saved = await failMysqlGeneratingMessage(assistant.id, tabId, fullContent, interrupted ? "interrupted" : "failed", errorMessage);
        const tabVersion = operationFinished ? undefined : await failMysqlTabOperation(operation, errorMessage);
        send(controller, "error", { message: errorMessage, interrupted, ...messageJson(saved ?? assistant), ...(userMessage ? { userMessageId: userMessage.id } : {}), ...(tabVersion === undefined ? {} : { tabVersion }) });
      } finally {
        releaseGeneration(assistant.id, generation);
        close(controller);
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
