import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Message from "@/models/Message";
import { findOwnedTab, parseObjectId } from "@/lib/ownership";
import { cancelGeneration } from "@/lib/generation-control";

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

    const serialized = messages.map((m) => ({
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
    }));

    return NextResponse.json({ messages: serialized });
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
    const messageId = new URL(request.url).searchParams.get("messageId");
    const messageObjectId = parseObjectId(messageId ?? "");
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
      return NextResponse.json(
        { error: "消息不是生成中状态，无法停止" },
        { status: 409 }
      );
    }

    cancelGeneration(message._id.toString());
    return NextResponse.json({
      message: {
        id: message._id.toString(),
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        status: message.status,
        errorMessage: message.error_message,
      },
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
    const searchParams = new URL(request.url).searchParams;
    const messageId = searchParams.get("messageId");
    const fromMessageId = searchParams.get("fromMessageId");
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

    if (fromMessageId) {
      // 按聊天展示顺序定位目标，包含目标消息本身，避免编辑重发后保留旧用户消息。
      const orderedMessages = await Message.find({ tab_id: tab._id })
        .sort({ timestamp: 1, _id: 1 })
        .select({ _id: 1, role: 1 })
        .lean();
      const targetIndex = orderedMessages.findIndex(
        (message) => message._id.toString() === messageObjectId.toString()
      );
      if (targetIndex === -1) {
        return NextResponse.json({ error: "消息不存在" }, { status: 404 });
      }
      if (orderedMessages[targetIndex].role !== "user") {
        return NextResponse.json(
          { error: "只能编辑用户消息" },
          { status: 409 }
        );
      }

      const idsToDelete = orderedMessages
        .slice(targetIndex)
        .map((message) => message._id);
      const result = await Message.deleteMany({
        _id: { $in: idsToDelete },
        tab_id: tab._id,
      });
      return NextResponse.json({
        success: true,
        deletedCount: result.deletedCount,
      });
    }

    const deleted = await Message.findOneAndDelete({
      _id: messageObjectId,
      tab_id: tab._id,
    });
    if (!deleted) {
      return NextResponse.json({ error: "消息不存在" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/tabs/[id]/messages error:", error);
    return NextResponse.json({ error: "删除消息失败" }, { status: 500 });
  }
}
