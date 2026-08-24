import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Message from "@/models/Message";
import MessageFileWrite from "@/models/MessageFileWrite";
import AgentFileContext from "@/models/AgentFileContext";
import TabOperation from "@/models/TabOperation";
import { acquireTabWriteLease } from "@/lib/deletion-coordination";
import {
  TAB_CONFLICT_MESSAGE,
  parseTabMutationRequest,
} from "@/lib/tab-concurrency";
import { renameMysqlTab } from "@/lib/mysql-account-workspace";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { isMysqlId } from "@/lib/identifiers";
import {
  deleteMysqlTab,
  getMysqlTabMessageMutationTestOptions,
} from "@/lib/mysql-tab-message-mutations";
import { parseMysqlTabMutationRequest } from "@/lib/mysql-tab-concurrency";

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

    const updated = await renameMysqlTab(
      tabId,
      userId,
      display_name.trim(),
      mutationRequest.expectedVersion,
      mutationRequest.requestId
    );
    if (updated.kind === "not-found") {
      return NextResponse.json(
        { error: "标签页不存在或无权操作" },
        { status: 404 }
      );
    }
    if (updated.kind === "conflict") {
      return tabConflictResponse(updated.currentVersion);
    }
    if (updated.kind === "request-id-mismatch") {
      return NextResponse.json(
        { error: "请求标识已用于其他操作" },
        { status: 409 }
      );
    }
    return NextResponse.json(updated.tab);
  } catch (error) {
    console.error("PATCH /api/tabs/[id] error:", error);
    return NextResponse.json(
      { error: mysqlUnavailableMessage() },
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

    if (isMysqlId(tabId)) {
      const body = (await request.json().catch(() => null)) ?? {};
      const mutation = parseMysqlTabMutationRequest(body);
      if (!mutation) {
        return NextResponse.json({ error: "并发请求参数无效" }, { status: 400 });
      }
      const result = await deleteMysqlTab({
        tabId,
        userId,
        mutation,
        options: getMysqlTabMessageMutationTestOptions(request),
      });
      return NextResponse.json(result.body, { status: result.status });
    }

    await dbConnect();

    const writeLease = await acquireTabWriteLease(tabId, userId);
    if (!writeLease) {
      return NextResponse.json(
        { error: "标签页不存在或无权操作" },
        { status: 404 }
      );
    }
    const tab = writeLease.tab;

    try {
      // Delete all associated messages and file contexts
      await MessageFileWrite.deleteMany({ tab_id: tab._id });
      await Message.deleteMany({ tab_id: tab._id });
      await AgentFileContext.deleteMany({ tab_id: tab._id });
      await TabOperation.deleteMany({ tab_id: tab._id });
      await tab.deleteOne();

      return NextResponse.json({ success: true });
    } finally {
      await writeLease.release();
    }
  } catch (error) {
    console.error("DELETE /api/tabs/[id] error:", error);
    return NextResponse.json(
      { error: "删除标签页失败" },
      { status: 500 }
    );
  }
}
