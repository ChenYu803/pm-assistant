import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Tab from "@/models/Tab";
import Message from "@/models/Message";
import { findOwnedTab } from "@/lib/ownership";
import { serializeTab } from "@/lib/tab-helpers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: tabId } = await params;

    const body = await request.json();
    const { display_name } = body;

    if (!display_name || typeof display_name !== "string" || !display_name.trim()) {
      return NextResponse.json(
        { error: "标签页名称不能为空" },
        { status: 400 }
      );
    }

    await dbConnect();

    const tab = await findOwnedTab(tabId, userId);
    if (!tab) {
      return NextResponse.json(
        { error: "标签页不存在或无权操作" },
        { status: 404 }
      );
    }

    tab.display_name = display_name.trim();
    await tab.save();

    return NextResponse.json(serializeTab(tab));
  } catch (error) {
    console.error("PATCH /api/tabs/[id] error:", error);
    return NextResponse.json(
      { error: "更新标签页失败" },
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

    await dbConnect();

    const tab = await findOwnedTab(tabId, userId);
    if (!tab) {
      return NextResponse.json(
        { error: "标签页不存在或无权操作" },
        { status: 404 }
      );
    }

    // Delete all associated messages and the tab itself
    await Message.deleteMany({ tab_id: tab._id });
    // TODO: Delete agent_file_contexts when that model is added (Ticket 5/7)
    await tab.deleteOne();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/tabs/[id] error:", error);
    return NextResponse.json(
      { error: "删除标签页失败" },
      { status: 500 }
    );
  }
}
