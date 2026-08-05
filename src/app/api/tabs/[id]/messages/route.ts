import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Message from "@/models/Message";
import { findOwnedTab } from "@/lib/ownership";

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
