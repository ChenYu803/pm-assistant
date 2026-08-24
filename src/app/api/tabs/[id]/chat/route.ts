import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Message, { ensureMessageRequestIdIndex } from "@/models/Message";
import Tab, { type ITabDocument } from "@/models/Tab";
import { parseObjectId } from "@/lib/ownership";
import { acquireTabWriteLease } from "@/lib/deletion-coordination";
import { AGENT_SYSTEM_PROMPTS } from "@/lib/agent-prompts";
import type { AgentType, FreezeStatus } from "@/lib/agent-constants";
import { stripChangelogHeader } from "@/lib/file-helpers";
import { getLoadedContextFiles } from "@/lib/context-files";
import { createAIStream, isAIConfigured } from "@/lib/ai";
import type { AIMessage } from "@/lib/ai";
import type {
  AssistantMessageStatus,
  MessageReplacementKind,
} from "@/models/Message";
import {
  registerGeneration,
  releaseGeneration,
} from "@/lib/generation-control";
import { getVisibleMessages } from "@/lib/message-recovery";
import {
  TAB_CONFLICT_MESSAGE,
  beginTabOperation,
  completeTabOperation,
  failTabOperation,
  parseTabMutationRequest,
  recordTabOperationResult,
  waitForTabOperation,
} from "@/lib/tab-concurrency";
import {
  SCOPE_FREEZE_PROPOSAL_MARKER,
  freezeGenerationInstruction,
  getExpectedFreezeDocument,
  supportsScopeFreeze,
} from "@/lib/freeze-protocol";
import { getPersistedFreezeState } from "@/lib/tab-freeze-state";
import { freezeDocumentDigest } from "@/lib/freeze-document-digest";
import { isMysqlId } from "@/lib/identifiers";
import { postMysqlChat } from "@/lib/mysql-chat";

class GenerationInterruptedError extends Error {
  constructor() {
    super("生成已停止");
    this.name = "GenerationInterruptedError";
  }
}

const encoder = new TextEncoder();

function sseEvent(type: string, data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

/**
 * 客户端传输中断不等于服务端生成失败。消息状态先持久化；SSE 控制器已关闭时
 * 跳过后续通知，刷新或重连仍可从服务端消息事实源恢复最终状态。
 */
function enqueueSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  type: string,
  data: Record<string, unknown>
): void {
  if (controller.desiredSize === null) return;
  try {
    controller.enqueue(sseEvent(type, data));
  } catch (error) {
    // Node/Next 可能在 desiredSize 检查后关闭控制器；此时数据库状态仍可恢复。
    if (!(error instanceof TypeError && error.message.includes("already closed"))) {
      throw error;
    }
  }
}

function closeSse(controller: ReadableStreamDefaultController<Uint8Array>): void {
  if (controller.desiredSize === null) return;
  try {
    controller.close();
  } catch (error) {
    if (!(error instanceof TypeError && error.message.includes("already closed"))) {
      throw error;
    }
  }
}

type TransientFreezeStatus = Exclude<FreezeStatus, "frozen">;

async function persistFreezeState({
  tab,
  status,
  messageId,
  filename,
  documentDigest,
  error,
}: {
  tab: ITabDocument;
  status: TransientFreezeStatus;
  messageId?: ITabDocument["freeze_message_id"];
  filename?: string;
  documentDigest?: string;
  error?: string;
}): Promise<void> {
  const set: Record<string, unknown> = { freeze_status: status };
  const unset: Record<string, 1> = {};
  if (messageId) set.freeze_message_id = messageId;
  else unset.freeze_message_id = 1;
  if (filename) set.freeze_filename = filename;
  else unset.freeze_filename = 1;
  if (documentDigest) set.freeze_document_digest = documentDigest;
  else unset.freeze_document_digest = 1;
  if (error) set.freeze_error = error;
  else unset.freeze_error = 1;
  await Tab.collection.updateOne(
    { _id: tab._id },
    {
      $set: set,
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    }
  );
  tab.freeze_status = status;
  tab.freeze_message_id = messageId;
  tab.freeze_filename = filename;
  tab.freeze_error = error;
}

type RequestReplayMessage = {
  _id: { toString(): string };
  content: string;
  timestamp: Date;
  status?: AssistantMessageStatus;
  error_message?: string;
  replacement_target_id?: { toString(): string };
  replacement_kind?: MessageReplacementKind;
};

function replayRequest(
  existingRequest: RequestReplayMessage,
  tabVersion?: number
): Response {
  const replay = new ReadableStream({
    start(controller) {
      const existingMessageId = existingRequest._id.toString();
      enqueueSse(controller, "start", {
        messageId: existingMessageId,
        status: existingRequest.status ?? "completed",
        timestamp: existingRequest.timestamp.toISOString(),
        ...(existingRequest.replacement_target_id
          ? {
              replacesMessageId:
                existingRequest.replacement_target_id.toString(),
            }
          : {}),
        ...(existingRequest.replacement_kind
          ? { replacementKind: existingRequest.replacement_kind }
          : {}),
        ...(tabVersion !== undefined ? { tabVersion } : {}),
      });
      if (existingRequest.status !== "generating") {
        enqueueSse(
          controller,
          existingRequest.status === "completed" ? "done" : "error",
          {
            messageId: existingMessageId,
            content: existingRequest.content,
            status: existingRequest.status ?? "completed",
            timestamp: existingRequest.timestamp.toISOString(),
            ...(existingRequest.error_message
              ? { errorMessage: existingRequest.error_message }
              : {}),
            ...(tabVersion !== undefined ? { tabVersion } : {}),
          }
        );
      }
      closeSse(controller);
    },
  });
  return new Response(replay, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function isDuplicateRequestIdError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

/** 各冻结 Agent 的「范围已冻结」系统提醒文案（注入 system prompt）。
 *  **键存在即成员**——同时承担「哪些 Agent 类型走冻结协议」的成员判定
 *  （spec: SCOPE_FROZEN 语义泛化为该 tab 的流程冻结标记；覆盖 mvp_prd
 *  的 PRD 范围冻结与 prototype 的原型「完满」冻结）。键拼错 = 编译错。 */
const FROZEN_REMINDERS: Partial<Record<AgentType, string>> = {
  mvp_prd:
    "当前 PRD 范围已冻结。如果用户提出新的功能需求，请礼貌地提醒用户范围已冻结，并建议将新需求放入后续迭代。不要修改已冻结的 PRD 范围。",
  prototype:
    "当前原型方案已冻结（用户已确认「完满」）。如果用户提出新的修改意见，请礼貌地提醒用户原型已冻结，并建议将修改放入下一轮迭代。不要修改已冻结的原型。",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: tabId } = await params;

    const body = await request.json();
    const {
      content,
      regenerate,
      messageId,
      editMessageId,
      retryMessageId,
      freeze,
    } = body;
    const mutationRequest = parseTabMutationRequest(body);
    const isRegenerate = regenerate === true;
    const isEdit = typeof editMessageId === "string";
    const isRetry = typeof retryMessageId === "string";
    const isFreeze = freeze === true;
    const operationCount =
      Number(isRegenerate) + Number(isEdit) + Number(isRetry) + Number(isFreeze);

    if (
      operationCount > 1 ||
      ((!isRegenerate && !isRetry && !isFreeze) &&
        (!content || typeof content !== "string" || !content.trim())) ||
      (isRegenerate &&
        (typeof messageId !== "string" || !parseObjectId(messageId))) ||
      (isEdit && !parseObjectId(editMessageId)) ||
      (isRetry && !parseObjectId(retryMessageId)) ||
      !mutationRequest
    ) {
      return NextResponse.json(
        {
          error:
            isRegenerate || isEdit || isRetry || isFreeze
              ? "生成请求参数无效"
              : "消息内容不能为空",
        },
        { status: 400 }
      );
    }

    if (isMysqlId(tabId)) {
      return postMysqlChat({ request, userId, tabId, body });
    }

    if (!isAIConfigured()) {
      return NextResponse.json(
        { error: "AI 服务未配置，请联系管理员设置 AI_API_KEY" },
        { status: 500 }
      );
    }

    await dbConnect();
    await ensureMessageRequestIdIndex();

    const writeLease = await acquireTabWriteLease(tabId, userId);
    if (!writeLease) {
      return NextResponse.json(
        { error: "标签页不存在或无权操作" },
        { status: 404 }
      );
    }
    let streamOwnsLease = false;
    try {
    const requestId = mutationRequest.requestId;
    const { tab, project } = writeLease;
    const persistedFreezeState = await getPersistedFreezeState(tab._id);

    // 同一个 requestId 只对应一条正式 assistant 消息。网络重放不会重新提交
    // 用户内容或创建第二条 assistant；生成中的重放只返回既有正式 ID。
    const existingRequest = await Message.findOne({
      tab_id: tab._id,
      request_id: requestId,
    }).lean();
    if (existingRequest) {
      return replayRequest(existingRequest, tab.version ?? 0);
    }

    if (
      isFreeze &&
      (!supportsScopeFreeze(tab.agent_type) ||
        persistedFreezeState.scopeFrozen ||
        !["proposed", "failed"].includes(
          persistedFreezeState.freezeStatus
        ))
    ) {
      return NextResponse.json(
        { error: "当前没有可确认的冻结提议" },
        { status: 409 }
      );
    }

    const operationStart = await beginTabOperation({
      tab,
      operation: isFreeze ? "freeze-generate" : "chat",
      request: mutationRequest,
    });
    if (operationStart.kind === "request-id-mismatch") {
      return NextResponse.json(
        { error: "请求标识已用于其他操作" },
        { status: 409 }
      );
    }
    if (operationStart.kind === "conflict") {
      return NextResponse.json(
        {
          error: TAB_CONFLICT_MESSAGE,
          code: "TAB_VERSION_CONFLICT",
          currentVersion: operationStart.currentVersion,
        },
        { status: 409 }
      );
    }
    if (operationStart.kind === "replay") {
      const replayOperation = await waitForTabOperation(operationStart.operation);
      const replayMessageId = replayOperation.result?.messageId;
      if (replayMessageId) {
        const replayMessage = await Message.findById(replayMessageId).lean();
        if (replayMessage) {
          return replayRequest(replayMessage, replayOperation.result?.tabVersion);
        }
      }
      if (replayOperation.status === "conflict") {
        return NextResponse.json(
          {
            error: TAB_CONFLICT_MESSAGE,
            code: "TAB_VERSION_CONFLICT",
            currentVersion: replayOperation.result?.tabVersion ?? null,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "请求正在处理中，请稍后重试" },
        { status: 409 }
      );
    }
    const operationTab = operationStart.tab;
    const tabOperation = operationStart.operation;
    // 后续冻结分支沿用刚读取的持久化事实，避免热更新旧 document 丢失字段。
    operationTab.scope_frozen = persistedFreezeState.scopeFrozen;
    operationTab.freeze_status = persistedFreezeState.freezeStatus;

    let systemPrompt = AGENT_SYSTEM_PROMPTS[operationTab.agent_type];

    // Inject tab identity for agents that need their own tab name: 需求分析
    // Agent names its working-doc file (需求分析-工作文档（{tab name}）.md);
    // PRD Agent names its concept-doc file (概念版（{tab name}）.md, 05 mini 会
    // 决策「概念版（Tab N）.md」落盘——display_name 即 Tab N). Other agents
    // have no per-tab placeholders; keep the injection surface minimal.
    if (
      operationTab.agent_type === "requirement_analyst" ||
      operationTab.agent_type === "mvp_prd"
    ) {
      systemPrompt += `\n\n## 当前标签页\n\n当前标签页名称：${operationTab.display_name}。`;
    }

    // Inject loaded file context into system prompt
    const contextFiles = await getLoadedContextFiles(operationTab._id, project._id);

    if (contextFiles.length > 0) {
      const fileBlocks = contextFiles.map((file) => {
        const body = stripChangelogHeader(file.content);
        return `### ${file.filename}\n\`\`\`markdown\n${body}\n\`\`\``;
      });
      systemPrompt +=
        "\n\n## 已加载的项目文件\n\n以下文件已加载到你的上下文中，请基于这些文件的内容进行工作：\n\n" +
        fileBlocks.join("\n\n");
    }

    // Scope-freeze gate for agents with freeze protocol (MVP-PRD / prototype)
    const frozenReminder = operationTab.scope_frozen
      ? FROZEN_REMINDERS[operationTab.agent_type]
      : undefined;
    if (frozenReminder) {
      systemPrompt += `\n\n## 范围冻结提醒\n\n${frozenReminder}`;
    }
    if (isFreeze) {
      systemPrompt += freezeGenerationInstruction({
        agentType: operationTab.agent_type,
        displayName: operationTab.display_name,
      });
    }

    const allHistoryMessages = await Message.find({ tab_id: operationTab._id })
      .sort({ timestamp: 1, _id: 1 })
      .lean();
    const visibleHistoryMessages = getVisibleMessages(allHistoryMessages);
    let historyMessages = visibleHistoryMessages;
    let userMessageId: string | undefined;
    let replacementKind: MessageReplacementKind | undefined;
    let replacementTargetId: ReturnType<typeof parseObjectId> | undefined;
    let replacementMessageIds: typeof allHistoryMessages = [];
    let replaceFromMessageId: string | undefined;
    let replacementUserContent: string | undefined;

    if (isRegenerate) {
      const targetId = parseObjectId(messageId);
      const targetIndex = visibleHistoryMessages.findIndex(
        (message) => message._id.toString() === targetId?.toString()
      );
      const target = visibleHistoryMessages[targetIndex];
      const hasLaterUsableMessage = visibleHistoryMessages.slice(targetIndex + 1).some(
        (message) =>
          message.role === "user" ||
          (message.role === "assistant" &&
            (message.status ?? "completed") === "completed")
      );
      if (
        !targetId ||
        !target ||
        target.role !== "assistant" ||
        (target.status ?? "completed") !== "completed" ||
        hasLaterUsableMessage
      ) {
        return NextResponse.json(
          { error: "只能重新输出最后一条已完成的 AI 回复" },
          { status: 409 }
        );
      }
      replacementKind = "regenerate";
      replacementTargetId = targetId;
      replacementMessageIds = visibleHistoryMessages.slice(targetIndex);
      replaceFromMessageId = target._id.toString();
      historyMessages = visibleHistoryMessages.slice(0, targetIndex);
    } else if (isEdit) {
      const targetId = parseObjectId(editMessageId);
      const targetIndex = visibleHistoryMessages.findIndex(
        (message) => message._id.toString() === targetId?.toString()
      );
      const target = visibleHistoryMessages[targetIndex];
      if (!targetId || !target || target.role !== "user") {
        return NextResponse.json(
          { error: "只能编辑当前可见的用户消息" },
          { status: 409 }
        );
      }
      replacementKind = "edit";
      replacementTargetId = targetId;
      replacementMessageIds = visibleHistoryMessages.slice(targetIndex);
      replaceFromMessageId = target._id.toString();
      replacementUserContent = content.trim();
      historyMessages = visibleHistoryMessages.slice(0, targetIndex);
    } else if (isRetry) {
      const previousAttempt = visibleHistoryMessages.find(
        (message) => message._id.toString() === retryMessageId
      );
      if (
        !previousAttempt ||
        previousAttempt.role !== "assistant" ||
        !["failed", "interrupted"].includes(previousAttempt.status ?? "completed")
      ) {
        return NextResponse.json(
          { error: "只能重试失败或中断的生成" },
          { status: 409 }
        );
      }
      replacementKind = previousAttempt.replacement_kind ?? "retry";
      const targetId = previousAttempt.replacement_target_id ?? previousAttempt._id;
      const targetIndex = visibleHistoryMessages.findIndex(
        (message) => message._id.toString() === targetId.toString()
      );
      if (replacementKind === "edit") {
        const hiddenReplacementUser = previousAttempt.replacement_user_message_id
          ? allHistoryMessages.find(
              (message) =>
                message._id.toString() ===
                previousAttempt.replacement_user_message_id?.toString()
            )
          : undefined;
        if (
          targetIndex === -1 ||
          !hiddenReplacementUser ||
          hiddenReplacementUser.role !== "user"
        ) {
          return NextResponse.json(
            { error: "编辑重发的重试上下文已失效" },
            { status: 409 }
          );
        }
        replacementTargetId = targetId;
        replacementMessageIds = visibleHistoryMessages.slice(targetIndex);
        replaceFromMessageId = targetId.toString();
        replacementUserContent = hiddenReplacementUser.content;
        historyMessages = visibleHistoryMessages.slice(0, targetIndex);
      } else if (replacementKind === "regenerate") {
        if (targetIndex === -1) {
          return NextResponse.json(
            { error: "重新输出的原消息已不存在" },
            { status: 409 }
          );
        }
        replacementTargetId = targetId;
        replacementMessageIds = visibleHistoryMessages.slice(targetIndex);
        replaceFromMessageId = targetId.toString();
        historyMessages = visibleHistoryMessages.slice(0, targetIndex);
      } else {
        if (targetIndex === -1) {
          return NextResponse.json(
            { error: "重试的原消息已不存在" },
            { status: 409 }
          );
        }
        // 普通失败可连续重试。始终从首次失败候选开始替换，避免成功后遗留
        // 更早失败气泡；原始用户消息位于它之前，因此继续保留在上下文中。
        replacementTargetId = targetId;
        replacementMessageIds = visibleHistoryMessages.slice(targetIndex);
        replaceFromMessageId = targetId.toString();
        historyMessages = visibleHistoryMessages.slice(0, targetIndex);
      }
    }

    const usableHistoryMessages = historyMessages.filter(
      (message) =>
        message.role !== "assistant" ||
        (message.status ?? "completed") === "completed"
    );
    const userContentForGeneration =
      replacementUserContent ?? (typeof content === "string" ? content.trim() : "");
    const appendsUserMessage = !isRegenerate && !isRetry && !isFreeze;

    // 构建模型输入：系统提示 + 可用历史 + 当前用户消息。
    const messages: AIMessage[] = [
      { role: "system", content: systemPrompt },
      ...usableHistoryMessages.map(
        (m) =>
          ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }) as AIMessage
      ),
      ...(appendsUserMessage
        ? [{ role: "user" as const, content: userContentForGeneration }]
        : []),
    ];

    // 先以唯一 requestId 保留正式 assistant，避免并发重放先重复写入用户消息。
    const assistantTimestamp = new Date();
    let assistantMessage;
    try {
      assistantMessage = await Message.create({
        role: "assistant",
        content: "",
        tab_id: operationTab._id,
        timestamp: assistantTimestamp,
        status: "generating",
        request_id: requestId,
        // 有此标记的新消息只相信消息级来源事实，绝不回退为同名文件推断。
        file_provenance_version: 1,
        ...(replacementTargetId
          ? { replacement_target_id: replacementTargetId }
          : {}),
        ...(replacementKind ? { replacement_kind: replacementKind } : {}),
      });
    } catch (error) {
      if (!isDuplicateRequestIdError(error)) {
        await failTabOperation(
          tabOperation,
          error instanceof Error ? error.message : "创建生成消息失败"
        );
        throw error;
      }
      const concurrentRequest = await Message.findOne({
        tab_id: operationTab._id,
        request_id: requestId,
      }).lean();
      if (!concurrentRequest) {
        await failTabOperation(tabOperation, "重复请求未找到既有消息");
        throw error;
      }
      await recordTabOperationResult(tabOperation, {
        messageId: concurrentRequest._id.toString(),
        tabVersion: tabOperation.locked_version ?? 0,
      });
      return replayRequest(concurrentRequest, tabOperation.locked_version ?? 0);
    }
    const assistantMessageId = assistantMessage._id.toString();
    let replacementUserMessage:
      | { id: string; role: "user"; content: string; timestamp: Date }
      | undefined;
    try {
      if (isFreeze) {
        await persistFreezeState({
          tab: operationTab,
          status: "generating",
          messageId: assistantMessage._id,
        });
      }
      if (!isRegenerate && !isEdit && !isRetry && !isFreeze) {
        const savedUserMessage = await Message.create({
          role: "user",
          content: content.trim(),
          tab_id: operationTab._id,
          // assistant 已先预留 requestId；时间提前 1ms 维持用户消息在前的历史顺序。
          timestamp: new Date(assistantTimestamp.getTime() - 1),
        });
        userMessageId = savedUserMessage._id.toString();
      }
      if (replacementKind === "edit" && replacementUserContent) {
        const savedReplacementUser = await Message.create({
          role: "user",
          content: replacementUserContent,
          tab_id: operationTab._id,
          // assistant 已先创建以取得提交屏障 ID；时间提前 1ms，确保刷新后的
          // 时间排序仍按“编辑后的用户消息 → 新 assistant”展示。
          timestamp: new Date(assistantMessage.timestamp.getTime() - 1),
          replacement_commit_message_id: assistantMessage._id,
        });
        replacementUserMessage = {
          id: savedReplacementUser._id.toString(),
          role: "user",
          content: savedReplacementUser.content,
          timestamp: savedReplacementUser.timestamp,
        };
        assistantMessage.replacement_user_message_id = savedReplacementUser._id;
        await assistantMessage.save();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "创建消息记录失败";
      await Message.updateOne(
        { _id: assistantMessage._id, status: "generating" },
        { $set: { status: "failed", error_message: errorMessage } }
      );
      const releasedTab = await failTabOperation(tabOperation, errorMessage);
      return NextResponse.json(
        { error: errorMessage, tabVersion: releasedTab?.version ?? null },
        { status: 500 }
      );
    }
    await recordTabOperationResult(tabOperation, {
      messageId: assistantMessageId,
      tabVersion: tabOperation.locked_version ?? 0,
    });

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        let fullContent = "";
        let tabOperationFinished = false;
        let freezeStatus: "proposed" | "awaiting_write" | undefined;
        const generationController = registerGeneration(assistantMessageId);
        let writeLeaseLost = false;
        const leaseHeartbeat = setInterval(() => {
          void writeLease
            .renew()
            .then((renewed) => {
              if (!renewed) {
                writeLeaseLost = true;
                generationController.abort();
              }
            })
            .catch(() => {
              writeLeaseLost = true;
              generationController.abort();
            });
        }, 5_000);

        enqueueSse(controller, "start", {
          messageId: assistantMessageId,
          status: "generating",
          timestamp: assistantMessage.timestamp.toISOString(),
          ...(userMessageId ? { userMessageId } : {}),
          ...(replacementTargetId
            ? { replacesMessageId: replacementTargetId.toString() }
            : {}),
          ...(replacementKind ? { replacementKind } : {}),
          tabVersion: tabOperation.locked_version ?? 0,
          ...(isFreeze
            ? {
                freezeStatus: "generating",
                freezeMessageId: assistantMessageId,
              }
            : {}),
        });

        try {
          const verifyFailureMode =
            process.env.NODE_ENV !== "production"
              ? request.headers.get("x-pm-verify-force-error")
              : null;
          if (verifyFailureMode === "zero-token") {
            throw new Error("回放强制零 token 失败");
          }
          // 上游流式请求显式超时：停滞转有界错误——错误 SSE 恢复输入框，
          // 调用方可继续重试。600s 与 SDK 默认一致：旧 180s 按 8K 输出上限
          // 设计，32K 上限下慢速轮次（HTML 快照 8-16K tokens @ 20-30 tps）
          // 需 530-800s，180s 会把正常长输出误杀（verify-v1-flow 等待 720s）。
          // timeout 必须作为第二参 RequestOptions 传——放 body 里 SDK 不读，
          // 运行时实际走 SDK 默认 10 分钟（2026-08-11 排查 tsc 类型错时发现）。
          const aiStream = await createAIStream({
            agentType: operationTab.agent_type,
            maxTokens: 32768,
            messages,
            timeoutMs: 600_000,
            signal: generationController.signal,
            // 仅开发回放验证使用，确保停止生成走真实 abort 与 partial 持久化路径。
            replayDelayMs:
              process.env.NODE_ENV !== "production" &&
              request.headers.get("x-pm-verify-stream-delay") === "1"
                ? 300
                : undefined,
          });

          for await (const chunk of aiStream) {
            if (generationController.signal.aborted || writeLeaseLost) {
              throw new GenerationInterruptedError();
            }
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              // 条件更新让其他进程发出的停止请求在下一个 token 发给客户端前生效。
              const updated = await Message.updateOne(
                {
                  _id: assistantMessage._id,
                  tab_id: operationTab._id,
                  status: "generating",
                },
                { $set: { content: fullContent } }
              );
              if (updated.matchedCount !== 1) {
                throw new GenerationInterruptedError();
              }
              enqueueSse(controller, "token", {
                messageId: assistantMessageId,
                content: delta,
              });
              if (verifyFailureMode === "after-token") {
                throw new Error("回放强制 partial 失败");
              }
            }
          }

          // 旧冻结 marker 仅为历史展示兼容而移除，绝不再根据用户自然语言
          // 改变冻结状态。新的 proposal marker 只让当前 Agent 回复创建提议。
          const hasFreezeProposal = fullContent.includes(
            SCOPE_FREEZE_PROPOSAL_MARKER
          );
          fullContent = fullContent
            .replace(/%%%SCOPE_FROZEN%%%/g, "")
            .replace(new RegExp(SCOPE_FREEZE_PROPOSAL_MARKER, "g"), "");
          if (isFreeze) {
            const freezeDocument = getExpectedFreezeDocument({
              agentType: operationTab.agent_type,
              displayName: operationTab.display_name,
              content: fullContent,
            });
            if (!freezeDocument) {
              throw new Error("冻结文档生成失败，未得到待写入的正式文件");
            }
            await persistFreezeState({
              tab: operationTab,
              status: "awaiting_write",
              messageId: assistantMessage._id,
              filename: freezeDocument.filename,
              documentDigest: freezeDocumentDigest(freezeDocument.content),
            });
            freezeStatus = "awaiting_write";
          } else if (
            supportsScopeFreeze(operationTab.agent_type) &&
            !operationTab.scope_frozen &&
            hasFreezeProposal
          ) {
            await persistFreezeState({
              tab: operationTab,
              status: "proposed",
            });
            freezeStatus = "proposed";
          }

          let savedMessage = await Message.findOneAndUpdate(
            {
              _id: assistantMessage._id,
              tab_id: operationTab._id,
              status: "generating",
            },
            {
              $set: {
                content: fullContent,
                status: "completed",
                error_message: undefined,
              },
            },
            { new: true }
          ).lean();
          if (!savedMessage) {
            throw new GenerationInterruptedError();
          }

          if (replacementMessageIds.length > 0) {
            try {
              const idsToSupersede = replacementMessageIds.map(
                (message) => message._id
              );
              const superseded = await Message.updateMany(
                {
                  _id: { $in: idsToSupersede },
                  tab_id: operationTab._id,
                  superseded_by_message_id: { $exists: false },
                },
                {
                  $set: { superseded_by_message_id: assistantMessage._id },
                }
              );
              if (superseded.matchedCount !== idsToSupersede.length) {
                throw new Error("待替换历史已变化，未提交新结果");
              }
              const committedMessage = await Message.findOneAndUpdate(
                {
                  _id: assistantMessage._id,
                  tab_id: operationTab._id,
                  status: "completed",
                  replacement_committed: false,
                },
                { $set: { replacement_committed: true } },
                { new: true }
              ).lean();
              if (!committedMessage) {
                throw new Error("新结果替换提交失败");
              }
              savedMessage = committedMessage;
            } catch (replacementError) {
              // 提交屏障尚未开启时，getVisibleMessages 仍会展示旧历史；将候选
              // 标成失败使用户可以重试，而不会把已生成内容伪装为成功替换。
              await Message.updateOne(
                {
                  _id: assistantMessage._id,
                  tab_id: operationTab._id,
                  status: "completed",
                  replacement_committed: false,
                },
                {
                  $set: {
                    status: "failed",
                    error_message:
                      replacementError instanceof Error
                        ? replacementError.message
                        : "新结果替换提交失败",
                  },
                }
              );
              throw replacementError;
            }
          }

          const completedTab = await completeTabOperation(tabOperation, {
            messageId: assistantMessageId,
          });
          tabOperationFinished = true;

          enqueueSse(controller, "done", {
            messageId: assistantMessageId,
            content: savedMessage.content,
            status: savedMessage.status,
            timestamp: savedMessage.timestamp.toISOString(),
            ...(userMessageId ? { userMessageId } : {}),
            ...(replacementMessageIds.length > 0
              ? {
                  replacesMessageIds: replacementMessageIds.map((message) =>
                    message._id.toString()
                  ),
                  replaceFromMessageId,
                }
              : {}),
            ...(replacementUserMessage
              ? {
                  replacementUserMessage: {
                    ...replacementUserMessage,
                    timestamp: replacementUserMessage.timestamp.toISOString(),
                  },
                }
              : {}),
            tabVersion: completedTab.version ?? 0,
            ...(freezeStatus
              ? {
                  freezeStatus,
                  freezeMessageId: assistantMessageId,
                }
              : {}),
          });
        } catch (err) {
          const interrupted =
            err instanceof GenerationInterruptedError ||
            generationController.signal.aborted;
          if (!interrupted) console.error("Stream error:", err);
          const streamErrorMessage =
            interrupted
              ? "生成已停止"
              : err instanceof Error
                ? err.message
                : "AI 请求失败，请稍后重试";
          if (isFreeze && !tabOperationFinished) {
            await persistFreezeState({
              tab: operationTab,
              status: "failed",
              messageId: assistantMessage._id,
              error: streamErrorMessage,
            });
          }
          const message =
            (await Message.findOneAndUpdate(
              {
                _id: assistantMessage._id,
                tab_id: operationTab._id,
                status: "generating",
              },
              {
                $set: {
                  content: fullContent,
                  status: interrupted ? "interrupted" : "failed",
                  error_message: streamErrorMessage,
                },
              },
              { new: true }
            ).lean()) ??
            (await Message.findById(assistantMessage._id).lean());
          const releasedTab = tabOperationFinished
            ? null
            : await failTabOperation(tabOperation, streamErrorMessage);
          enqueueSse(controller, "error", {
            message: streamErrorMessage,
            interrupted,
            messageId: assistantMessageId,
            content: message?.content ?? fullContent,
            status: message?.status ?? (interrupted ? "interrupted" : "failed"),
            timestamp: message?.timestamp?.toISOString() ?? assistantMessage.timestamp.toISOString(),
            ...(message?.error_message ? { errorMessage: message.error_message } : {}),
            ...(userMessageId ? { userMessageId } : {}),
            ...(replacementTargetId
              ? { replacesMessageId: replacementTargetId.toString() }
              : {}),
            ...(replacementKind ? { replacementKind } : {}),
            ...(releasedTab ? { tabVersion: releasedTab.version ?? 0 } : {}),
            ...(isFreeze && !tabOperationFinished
              ? {
                  freezeStatus: "failed",
                  freezeMessageId: assistantMessageId,
                  freezeError: streamErrorMessage,
                }
              : {}),
          });
        } finally {
          clearInterval(leaseHeartbeat);
          releaseGeneration(assistantMessageId, generationController);
          await writeLease.release();
          closeSse(controller);
        }
      },
    });

    streamOwnsLease = true;
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
    } finally {
      if (!streamOwnsLease) await writeLease.release();
    }
  } catch (error) {
    console.error("POST /api/tabs/[id]/chat error:", error);
    return NextResponse.json(
      { error: "发送消息失败" },
      { status: 500 }
    );
  }
}
