import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import AgentFileContext from "@/models/AgentFileContext";
import {
  findOwnedTabWithProject,
  findOwnedProjectFileInProject,
  parseObjectId,
} from "@/lib/ownership";

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

    if (!parseObjectId(fileId)) {
      return NextResponse.json(
        { error: "fileId 参数无效" },
        { status: 400 }
      );
    }

    const ownedTab = await findOwnedTabWithProject(tabId, userId);
    if (!ownedTab) {
      return NextResponse.json(
        { error: "标签页不存在或无权访问" },
        { status: 404 }
      );
    }
    const { tab, project } = ownedTab;

    const file = await findOwnedProjectFileInProject(
      project._id.toString(),
      fileId,
      userId
    );
    if (!file) {
      return NextResponse.json(
        { error: "文件不存在或无权访问" },
        { status: 404 }
      );
    }

    const result = await AgentFileContext.deleteOne({
      tab_id: tab._id,
      file_id: file._id,
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
