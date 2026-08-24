import { NextResponse } from "next/server";

import { AGENT_SYSTEM_PROMPTS } from "@/lib/agent-prompts";
import { createAIStream, isAIConfigured, type AIMessage } from "@/lib/ai";
import { stripChangelogHeader } from "@/lib/file-helpers";
import {
  freezeGenerationInstruction,
  getExpectedFreezeDocument,
  SCOPE_FREEZE_PROPOSAL_MARKER,
  supportsScopeFreeze,
} from "@/lib/freeze-protocol";
import {
  completeMysqlFreezeGeneration,
  failMysqlFreezeGeneration,
  mysqlFreezeStateFromTab,
  markMysqlFreezeProposed,
  setMysqlFreezeGenerating,
} from "@/lib/mysql-freeze";
import {
  completeMysqlMessage,
  createMysqlChatStart,
  failMysqlGeneratingMessage,
  findOwnedMysqlConversationTab,
  findMysqlMessageByRequest,
  getVisibleMysqlMessages,
  listMysqlMessages,
  type MysqlMessage,
  type MysqlReplacementKind,
  updateMysqlGeneratingMessage,
} from "@/lib/mysql-conversation";
import { listMysqlLoadedContextFiles } from "@/lib/mysql-project-artifacts";
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

const FROZEN_REMINDERS = {
  mvp_prd:
    "当前 PRD 范围已冻结。如果用户提出新的功能需求，请礼貌地提醒用户范围已冻结，并建议将新需求放入后续迭代。不要修改已冻结的 PRD 范围。",
  prototype:
    "当前原型方案已冻结（用户已确认「完满」）。如果用户提出新的修改意见，请礼貌地提醒用户原型已冻结，并建议将修改放入下一轮迭代。不要修改已冻结的原型。",
} as const;

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
  if (!isAIConfigured()) return NextResponse.json({ error: "AI 服务未配置，请联系管理员设置 AI_API_KEY" }, { status: 500 });

  const tab = await findOwnedMysqlConversationTab(tabId, userId);
  if (!tab) return NextResponse.json({ error: "标签页不存在或无权操作" }, { status: 404 });
  const existing = await findMysqlMessageByRequest(tabId, mutation.requestId);
  if (existing) return replayMysqlRequest(existing);
  const freezeState = mysqlFreezeStateFromTab(tab);
  if (
    isFreeze &&
    (!supportsScopeFreeze(tab.agent_type) ||
      freezeState.scopeFrozen ||
      !["proposed", "failed"].includes(freezeState.freezeStatus))
  ) return NextResponse.json({ error: "当前没有可确认的冻结提议" }, { status: 409 });
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
      return NextResponse.json({ error: "只能重试失败或中断的生成" }, { status: 409 });
    }
    replacementKind = previous.replacement_kind ?? "retry";
    replacementTargetId = previous.replacement_target_id ?? previous.id;
    const targetIndex = visible.findIndex((message) => message.id === replacementTargetId);
    if (targetIndex === -1) {
      return NextResponse.json({ error: "重试的原消息已不存在" }, { status: 409 });
    }
    supersedeIds = visible.slice(targetIndex).map((message) => message.id);
    history = visible.slice(0, targetIndex);
    if (replacementKind === "edit") {
      const edited = allMessages.find((message) => message.id === previous.replacement_user_message_id);
      if (!edited || edited.role !== "user") {
        return NextResponse.json({ error: "编辑重发的重试上下文已失效" }, { status: 409 });
      }
      replacementUserContent = edited.content;
    }
  }

  let prompt = `${AGENT_SYSTEM_PROMPTS[tab.agent_type]}${(tab.agent_type === "requirement_analyst" || tab.agent_type === "mvp_prd") ? `\n\n## 当前标签页\n\n当前标签页名称：${tab.display_name}。` : ""}`;
  const contextFiles = await listMysqlLoadedContextFiles(tab.id, tab.project_id);
  if (contextFiles.length > 0) {
    prompt += "\n\n## 已加载的项目文件\n\n以下文件已加载到你的上下文中，请基于这些文件的内容进行工作：\n\n" + contextFiles.map((file) => `### ${file.filename}\n\`\`\`markdown\n${stripChangelogHeader(file.content)}\n\`\`\``).join("\n\n");
  }
  if (freezeState.scopeFrozen) {
    const reminder = FROZEN_REMINDERS[tab.agent_type as keyof typeof FROZEN_REMINDERS];
    if (reminder) prompt += `\n\n## 范围冻结提醒\n\n${reminder}`;
  }
  if (isFreeze) {
    prompt += freezeGenerationInstruction({
      agentType: tab.agent_type,
      displayName: tab.display_name,
    });
  }
  const usableHistory = history.filter((message) => message.role !== "assistant" || message.status === "completed");
  const appendUser = !isRegenerate && !isRetry && !isFreeze;
  const userContent = replacementUserContent ?? (typeof content === "string" ? content.trim() : "");
  const messages: AIMessage[] = [
    { role: "system", content: prompt },
    ...usableHistory.map((message) => ({ role: message.role, content: message.content }) as AIMessage),
    ...(appendUser ? [{ role: "user" as const, content: userContent }] : []),
  ];

  const timestamp = new Date();
  const operationStart = await beginMysqlTabOperation({
    tabId,
    userId,
    operation: isFreeze ? "freeze-generate" : "chat",
    request: mutation,
    onClaimed: async (connection) => {
      const started = await createMysqlChatStart(connection, {
        tabId,
        requestId: mutation.requestId,
        timestamp,
        replacementTargetId,
        replacementKind,
        ...(appendUser ? { userContent } : {}),
        ...(replacementKind === "edit" && replacementUserContent ? { replacementUserContent } : {}),
      });
      if (isFreeze) {
        await setMysqlFreezeGenerating(connection, {
          tabId,
          requestId: mutation.requestId,
          messageId: started.assistant.id,
        });
      }
      return started;
    },
  });
  if (operationStart.kind === "not-found") return NextResponse.json({ error: "标签页不存在或无权操作" }, { status: 404 });
  if (operationStart.kind === "request-id-mismatch") return NextResponse.json({ error: "请求标识已用于其他操作" }, { status: 409 });
  if (operationStart.kind === "conflict") return conflict(operationStart.currentVersion);
  if (operationStart.kind === "replay") {
    const replay = await waitForMysqlTabOperation(operationStart.operation);
    const message = await findMysqlMessageByRequest(tabId, mutation.requestId);
    if (message) return replayMysqlRequest(message, replay.tab_version ?? undefined);
    return replay.status === "conflict" ? conflict(replay.tab_version) : NextResponse.json({ error: "请求正在处理中，请稍后重试" }, { status: 409 });
  }
  const operation = operationStart.operation;
  const started = operationStart.metadata as { assistant: MysqlMessage; userMessage?: { id: string; role: "user"; content: string; timestamp: Date } } | undefined;
  if (!started) {
    await failMysqlTabOperation(operation, "创建消息记录失败");
    return NextResponse.json({ error: "创建消息记录失败" }, { status: 500 });
  }
  const assistant = started.assistant;
  const userMessage = started.userMessage;

  const stream = new ReadableStream({
    async start(controller) {
      let fullContent = "";
      let operationFinished = false;
      const generation = registerGeneration(assistant.id);
      send(controller, "start", {
        ...messageJson(assistant),
        ...(userMessage ? { userMessageId: userMessage.id } : {}),
        tabVersion: operation.locked_version,
        ...(isFreeze ? { freezeStatus: "generating", freezeMessageId: assistant.id } : {}),
      });
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
        const freezeCompletion = isFreeze
          ? await completeMysqlFreezeGeneration((() => {
              const document = getExpectedFreezeDocument({
                agentType: tab.agent_type,
                displayName: tab.display_name,
                content: fullContent,
              });
              if (!document) throw new Error("冻结文档未按要求输出完整文件标记");
              return {
                tabId,
                requestId: mutation.requestId,
                messageId: assistant.id,
                content: fullContent,
                documentContent: document.content,
                filename: document.filename,
                operation,
              };
            })())
          : null;
        const completed = freezeCompletion
          ? { ...assistant, content: fullContent, status: "completed" as const, error_message: null }
          : await completeMysqlMessage({ messageId: assistant.id, tabId, content: fullContent, supersedeIds });
        const proposedFreeze =
          !isFreeze &&
          supportsScopeFreeze(tab.agent_type) &&
          fullContent.includes(SCOPE_FREEZE_PROPOSAL_MARKER);
        if (proposedFreeze) {
          await markMysqlFreezeProposed({ tabId, requestId: mutation.requestId });
        }
        const tabVersion = freezeCompletion?.tabVersion ?? await completeMysqlTabOperation(operation, { messageId: assistant.id });
        operationFinished = true;
        send(controller, "done", { ...messageJson(completed), ...(userMessage ? { userMessageId: userMessage.id } : {}), ...(supersedeIds.length ? { replacesMessageIds: supersedeIds, replaceFromMessageId: replacementTargetId } : {}), ...(isFreeze ? { freezeStatus: "awaiting_write", freezeMessageId: assistant.id } : proposedFreeze ? { freezeStatus: "proposed" } : {}), tabVersion });
      } catch (error) {
        const interrupted = error instanceof MysqlGenerationInterruptedError || generation.signal.aborted;
        const errorMessage = interrupted ? "生成已停止" : error instanceof Error ? error.message : "AI 请求失败，请稍后重试";
        const freezeFailure = isFreeze
          ? await failMysqlFreezeGeneration({
              tabId,
              requestId: mutation.requestId,
              messageId: assistant.id,
              content: fullContent,
              status: interrupted ? "interrupted" : "failed",
              errorMessage,
              operation,
            })
          : null;
        const saved = freezeFailure
          ? { ...assistant, content: fullContent, status: interrupted ? "interrupted" as const : "failed" as const, error_message: errorMessage }
          : await failMysqlGeneratingMessage(assistant.id, tabId, fullContent, interrupted ? "interrupted" : "failed", errorMessage);
        const tabVersion = operationFinished ? undefined : freezeFailure?.tabVersion ?? await failMysqlTabOperation(operation, errorMessage);
        send(controller, "error", { message: errorMessage, interrupted, ...messageJson(saved ?? assistant), ...(userMessage ? { userMessageId: userMessage.id } : {}), ...(isFreeze ? { freezeStatus: "failed", freezeMessageId: assistant.id, freezeError: errorMessage } : {}), ...(tabVersion === undefined ? {} : { tabVersion }) });
      } finally {
        releaseGeneration(assistant.id, generation);
        close(controller);
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
