import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Message from "@/models/Message";
import { findOwnedTab, parseObjectId } from "@/lib/ownership";

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
      .sort({ timestamp: 1 })
      .lean();

    const serialized = messages.map((m) => ({
      id: m._id.toString(),
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: tabId } = await params;
    const messageId = new URL(request.url).searchParams.get("messageId");
    const messageObjectId = messageId ? parseObjectId(messageId) : null;
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
