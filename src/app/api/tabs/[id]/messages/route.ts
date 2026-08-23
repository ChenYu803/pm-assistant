import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Message from "@/models/Message";
import { findOwnedTab, parseObjectId } from "@/lib/ownership";
import { cancelGeneration } from "@/lib/generation-control";
import { getVisibleMessages } from "@/lib/message-recovery";
import { getPersistedFreezeState } from "@/lib/tab-freeze-state";
import {
  TAB_CONFLICT_MESSAGE,
  beginPassiveTabOperation,
  beginTabOperation,
  completePassiveTabOperation,
  completeTabOperation,
  failTabOperation,
  parseTabMutationRequest,
  waitForTabOperation,
} from "@/lib/tab-concurrency";
import type { ITabOperationDocument } from "@/models/TabOperation";

function tabConflictResponse(currentVersion: number | null) {
  return NextResponse.json(
    {
      error: TAB_CONFLICT_MESSAGE,
      code: "TAB_VERSION_CONFLICT",
      currentVersion,
    },
    { status: 409 }
  );
}

async function replayOperationResponse(operation: ITabOperationDocument) {
  const replay = await waitForTabOperation(operation);
  if (replay.status === "conflict") {
    return tabConflictResponse(replay.result?.tabVersion ?? null);
  }
  if (replay.result?.response) {
    return NextResponse.json(
      {
        ...replay.result.response,
        ...(replay.result.tabVersion !== undefined
          ? { tabVersion: replay.result.tabVersion }
          : {}),
      },
      { status: replay.result.httpStatus ?? 200 }
    );
  }
  return NextResponse.json(
    { error: "请求正在处理中，请稍后重试" },
    { status: 409 }
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: tabId } = await params;

    await dbConnect();

    const tab = await findOwnedTab(tabId, userId);
    if (!tab) {
      return NextResponse.json(
        { error: "标签页不存在或无权访问" },
        { status: 404 }
      );
    }

    const messages = await Message.find({ tab_id: tab._id })
      .sort({ timestamp: 1, _id: 1 })
      .lean();
    const persistedTabState = await getPersistedFreezeState(tab._id);

    const serialized = getVisibleMessages(messages).map((m) => ({
      id: m._id.toString(),
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      ...(m.role === "assistant"
        ? {
            status: m.status ?? "completed",
            ...(m.error_message ? { errorMessage: m.error_message } : {}),
          }
        : {}),
      ...(m.replacement_target_id
        ? { replacesMessageId: m.replacement_target_id.toString() }
        : {}),
      ...(m.replacement_kind ? { replacementKind: m.replacement_kind } : {}),
    }));

    return NextResponse.json({
      messages: serialized,
      tabVersion: persistedTabState.version,
      freezeStatus: persistedTabState.freezeStatus,
      scopeFrozen: persistedTabState.scopeFrozen,
      ...(persistedTabState.freezeMessageId
        ? { freezeMessageId: persistedTabState.freezeMessageId }
        : {}),
      ...(persistedTabState.freezeError
        ? { freezeError: persistedTabState.freezeError }
        : {}),
    });
  } catch (error) {
    console.error("GET /api/tabs/[id]/messages error:", error);
    return NextResponse.json(
      { error: "获取消息记录失败" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: tabId } = await params;
    const body = await request.json().catch(() => null);
    const mutationRequest = parseTabMutationRequest(body);
    const messageObjectId = parseObjectId(
      typeof body?.messageId === "string"
        ? body.messageId
        : new URL(request.url).searchParams.get("messageId") ?? ""
    );
    if (!mutationRequest) {
      return NextResponse.json({ error: "并发请求参数无效" }, { status: 400 });
    }
    if (!messageObjectId) {
      return NextResponse.json({ error: "消息不存在" }, { status: 404 });
    }

    await dbConnect();
    const tab = await findOwnedTab(tabId, userId);
    if (!tab) {
      return NextResponse.json(
        { error: "标签页不存在或无权操作" },
        { status: 404 }
      );
    }

    const operationStart = await beginPassiveTabOperation({
      tab,
      operation: "stop-generation",
      request: mutationRequest,
    });
    if (operationStart.kind === "request-id-mismatch") {
      return NextResponse.json(
        { error: "请求标识已用于其他操作" },
        { status: 409 }
      );
    }
    if (operationStart.kind === "conflict") {
      return tabConflictResponse(operationStart.currentVersion);
    }
    if (operationStart.kind === "replay") {
      return replayOperationResponse(operationStart.operation);
    }
    const operation = operationStart.operation;

    // 先持久化中断状态，再尽力终止同一进程里的上游流。即使请求落到另一
    // 个进程，聊天路由逐 token 的条件更新也会观察到该状态并停止继续发送。
    const message = await Message.findOneAndUpdate(
      {
        _id: messageObjectId,
        tab_id: tab._id,
        role: "assistant",
        status: "generating",
      },
      {
        $set: {
          status: "interrupted",
          error_message: "生成已停止",
        },
      },
      { new: true }
    ).lean();
    if (!message) {
      const response = { error: "消息不是生成中状态，无法停止" };
      await completePassiveTabOperation(operation, {
        response,
        httpStatus: 409,
        tabVersion: operationStart.tab.version ?? 0,
      });
      return NextResponse.json(response, { status: 409 });
    }

    cancelGeneration(message._id.toString());
    const response = {
      message: {
        id: message._id.toString(),
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        status: message.status,
        errorMessage: message.error_message,
      },
    };
    await completePassiveTabOperation(operation, {
      response,
      tabVersion: operationStart.tab.version ?? 0,
    });
    return NextResponse.json({
      ...response,
      tabVersion: operationStart.tab.version ?? 0,
    });
  } catch (error) {
    console.error("PATCH /api/tabs/[id]/messages error:", error);
    return NextResponse.json({ error: "停止生成失败" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: tabId } = await params;
    const body = await request.json().catch(() => null);
    const mutationRequest = parseTabMutationRequest(body);
    const searchParams = new URL(request.url).searchParams;
    const messageId =
      typeof body?.messageId === "string"
        ? body.messageId
        : searchParams.get("messageId");
    const fromMessageId =
      typeof body?.fromMessageId === "string"
        ? body.fromMessageId
        : searchParams.get("fromMessageId");
    if (!mutationRequest) {
      return NextResponse.json({ error: "并发请求参数无效" }, { status: 400 });
    }
    if (messageId && fromMessageId) {
      return NextResponse.json(
        { error: "不能同时指定单条删除和截断删除" },
        { status: 400 }
      );
    }

    const messageObjectId = parseObjectId(fromMessageId ?? messageId ?? "");
    if (!messageObjectId) {
      return NextResponse.json({ error: "消息不存在" }, { status: 404 });
    }

    await dbConnect();
    const tab = await findOwnedTab(tabId, userId);
    if (!tab) {
      return NextResponse.json(
        { error: "标签页不存在或无权操作" },
        { status: 404 }
      );
    }

    const operationStart = await beginTabOperation({
      tab,
      operation: fromMessageId ? "truncate-messages" : "delete-message",
      request: mutationRequest,
    });
    if (operationStart.kind === "request-id-mismatch") {
      return NextResponse.json(
        { error: "请求标识已用于其他操作" },
        { status: 409 }
      );
    }
    if (operationStart.kind === "conflict") {
      return tabConflictResponse(operationStart.currentVersion);
    }
    if (operationStart.kind === "replay") {
      return replayOperationResponse(operationStart.operation);
    }
    const operation = operationStart.operation;

    try {
      if (fromMessageId) {
      // 按聊天展示顺序定位目标，包含目标消息本身，避免编辑重发后保留旧用户消息。
      const orderedMessages = await Message.find({ tab_id: operationStart.tab._id })
        .sort({ timestamp: 1, _id: 1 })
        .select({ _id: 1, role: 1 })
        .lean();
      const targetIndex = orderedMessages.findIndex(
        (message) => message._id.toString() === messageObjectId.toString()
      );
      if (targetIndex === -1) {
        const response = { error: "消息不存在" };
        const completedTab = await completeTabOperation(operation, {
          response,
          httpStatus: 404,
        });
        return NextResponse.json(
          { ...response, tabVersion: completedTab.version ?? 0 },
          { status: 404 }
        );
      }
      if (orderedMessages[targetIndex].role !== "user") {
        const response = { error: "只能编辑用户消息" };
        const completedTab = await completeTabOperation(operation, {
          response,
          httpStatus: 409,
        });
        return NextResponse.json(
          { ...response, tabVersion: completedTab.version ?? 0 },
          { status: 409 }
        );
      }

      const idsToDelete = orderedMessages
        .slice(targetIndex)
        .map((message) => message._id);
      const result = await Message.deleteMany({
        _id: { $in: idsToDelete },
        tab_id: operationStart.tab._id,
      });
      const response = {
        success: true,
        deletedCount: result.deletedCount,
      };
      const completedTab = await completeTabOperation(operation, { response });
      return NextResponse.json({
        ...response,
        tabVersion: completedTab.version ?? 0,
      });
      }

      const deleted = await Message.findOneAndDelete({
        _id: messageObjectId,
        tab_id: operationStart.tab._id,
      });
      if (!deleted) {
        const response = { error: "消息不存在" };
        const completedTab = await completeTabOperation(operation, {
          response,
          httpStatus: 404,
        });
        return NextResponse.json(
          { ...response, tabVersion: completedTab.version ?? 0 },
          { status: 404 }
        );
      }

      const response = { success: true };
      const completedTab = await completeTabOperation(operation, { response });
      return NextResponse.json({
        ...response,
        tabVersion: completedTab.version ?? 0,
      });
    } catch (error) {
      await failTabOperation(
        operation,
        error instanceof Error ? error.message : "删除消息失败"
      );
      throw error;
    }
  } catch (error) {
    console.error("DELETE /api/tabs/[id]/messages error:", error);
    return NextResponse.json({ error: "删除消息失败" }, { status: 500 });
  }
}
