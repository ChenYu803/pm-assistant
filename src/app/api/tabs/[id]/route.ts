import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Message from "@/models/Message";
import AgentFileContext from "@/models/AgentFileContext";
import { findOwnedTab } from "@/lib/ownership";
import { serializeTab } from "@/lib/tab-helpers";
import {
  TAB_CONFLICT_MESSAGE,
  beginTabOperation,
  completeTabOperation,
  failTabOperation,
  parseTabMutationRequest,
  waitForTabOperation,
} from "@/lib/tab-concurrency";

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
    const mutationRequest = parseTabMutationRequest(body);

    if (
      !display_name ||
      typeof display_name !== "string" ||
      !display_name.trim() ||
      !mutationRequest
    ) {
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

    const operationStart = await beginTabOperation({
      tab,
      operation: "rename-tab",
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
      const replay = await waitForTabOperation(operationStart.operation);
      if (replay.status === "conflict") {
        return tabConflictResponse(replay.result?.tabVersion ?? null);
      }
      if (replay.result?.response) {
        return NextResponse.json({
          ...replay.result.response,
          version: replay.result.tabVersion ?? 0,
        });
      }
      return NextResponse.json(
        { error: "请求正在处理中，请稍后重试" },
        { status: 409 }
      );
    }

    try {
      operationStart.tab.display_name = display_name.trim();
      await operationStart.tab.save();
      const response = { ...serializeTab(operationStart.tab) };
      const completedTab = await completeTabOperation(operationStart.operation, {
        response,
      });

      return NextResponse.json(serializeTab(completedTab));
    } catch (error) {
      await failTabOperation(
        operationStart.operation,
        error instanceof Error ? error.message : "更新标签页失败"
      );
      throw error;
    }
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

    // Delete all associated messages and file contexts
    await Message.deleteMany({ tab_id: tab._id });
    await AgentFileContext.deleteMany({ tab_id: tab._id });
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
