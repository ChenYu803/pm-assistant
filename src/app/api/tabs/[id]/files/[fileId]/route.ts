import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import AgentFileContext from "@/models/AgentFileContext";
import { findOwnedTab } from "@/lib/ownership";

/** Remove a file from a tab's agent context. The fileId is the ProjectFile ID. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: tabId, fileId } = await params;

    await dbConnect();

    const tab = await findOwnedTab(tabId, userId);
    if (!tab) {
      return NextResponse.json(
        { error: "标签页不存在或无权访问" },
        { status: 404 }
      );
    }

    const result = await AgentFileContext.deleteOne({
      tab_id: tab._id,
      file_id: fileId,
    });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: "该文件未在上下文中" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/tabs/[id]/files/[fileId] error:", error);
    return NextResponse.json(
      { error: "移除上下文文件失败" },
      { status: 500 }
    );
  }
}
