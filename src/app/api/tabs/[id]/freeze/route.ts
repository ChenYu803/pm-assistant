import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import { findOwnedTabWithProject } from "@/lib/ownership";
import ProjectFile from "@/models/ProjectFile";
import Tab from "@/models/Tab";
import {
  TAB_CONFLICT_MESSAGE,
  beginTabOperation,
  completeTabOperation,
  failTabOperation,
  parseTabMutationRequest,
  waitForTabOperation,
} from "@/lib/tab-concurrency";
import type { ITabOperationDocument } from "@/models/TabOperation";
import TabOperation from "@/models/TabOperation";
import { getPersistedFreezeState } from "@/lib/tab-freeze-state";
import { freezeDocumentDigest } from "@/lib/freeze-document-digest";
import { stripChangelogHeader } from "@/lib/file-helpers";
import {
  acquireFreezeDocumentBinding,
  releaseFreezeDocumentBinding,
} from "@/lib/freeze-document-binding";
import type { FreezeStatus } from "@/lib/agent-constants";

type FreezeAction = "cancel" | "complete";

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

function freezeResponse({
  freezeStatus,
  scopeFrozen,
  freezeMessageId,
  freezeError,
}: {
  freezeStatus: FreezeStatus;
  scopeFrozen: boolean;
  freezeMessageId?: string;
  freezeError?: string;
}) {
  return {
    freezeStatus,
    scopeFrozen,
    ...(freezeMessageId ? { freezeMessageId } : {}),
    ...(freezeError ? { freezeError } : {}),
  };
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: tabId } = await params;
    const body = await request.json().catch(() => null);
    const mutationRequest = parseTabMutationRequest(body);
    const action = body?.action as FreezeAction | undefined;
    if (!mutationRequest || (action !== "cancel" && action !== "complete")) {
      return NextResponse.json({ error: "冻结操作参数无效" }, { status: 400 });
    }

    await dbConnect();
    const ownedTab = await findOwnedTabWithProject(tabId, userId);
    if (!ownedTab) {
      return NextResponse.json(
        { error: "标签页不存在或无权操作" },
        { status: 404 }
      );
    }
    const { tab, project } = ownedTab;
    const persistedFreezeState = await getPersistedFreezeState(tab._id);
    const operationName = `freeze-${action}`;
    const existingOperation = await TabOperation.findOne({
      tab_id: tab._id,
      request_id: mutationRequest.requestId,
    });
    if (existingOperation) {
      if (existingOperation.operation !== operationName) {
        return NextResponse.json(
          { error: "请求标识已用于其他操作" },
          { status: 409 }
        );
      }
      return replayOperationResponse(existingOperation);
    }
    if (
      persistedFreezeState.scopeFrozen ||
      persistedFreezeState.freezeStatus !== "awaiting_write"
    ) {
      return NextResponse.json(
        { error: "当前没有待确认写入的冻结文档" },
        { status: 409 }
      );
    }
    if (
      action === "complete" &&
      (!persistedFreezeState.freezeFilename ||
        !persistedFreezeState.freezeDocumentDigest)
    ) {
      return NextResponse.json(
        { error: "冻结文档信息缺失，无法正式冻结" },
        { status: 409 }
      );
    }

    const operationStart = await beginTabOperation({
      tab,
      operation: operationName,
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

      const operationTab = operationStart.tab;
      const operation = operationStart.operation;
      let acquiredBinding = false;
      let freezeStatePersisted = false;
      try {
        if (action === "complete") {
        const freezeFilename = persistedFreezeState.freezeFilename!;
        const expectedDocumentDigest =
          persistedFreezeState.freezeDocumentDigest!;
        const writtenFile = await ProjectFile.findOne({
          project_id: project._id,
          filename: freezeFilename,
        }).lean();
        if (!writtenFile) {
          const response = { error: "冻结文档尚未写入项目" };
          const completedTab = await completeTabOperation(operation, {
            response,
            httpStatus: 409,
          });
          return NextResponse.json(
            { ...response, tabVersion: completedTab.version ?? 0 },
            { status: 409 }
          );
        }
        if (
          freezeDocumentDigest(stripChangelogHeader(writtenFile.content)) !==
          expectedDocumentDigest
        ) {
          const response = { error: "冻结文档内容与本次生成结果不一致" };
          const completedTab = await completeTabOperation(operation, {
            response,
            httpStatus: 409,
          });
          return NextResponse.json(
            { ...response, tabVersion: completedTab.version ?? 0 },
            { status: 409 }
          );
        }
        const bound = await acquireFreezeDocumentBinding({
          projectId: project._id,
          filename: freezeFilename,
          expectedContent: writtenFile.content,
          tabId: operationTab._id,
          documentDigest: expectedDocumentDigest,
        });
        if (!bound) {
          const latestFile = await ProjectFile.collection.findOne({
            project_id: project._id,
            filename: freezeFilename,
          });
          const latestContent =
            typeof latestFile?.content === "string" ? latestFile.content : "";
          const response = {
            error:
              freezeDocumentDigest(stripChangelogHeader(latestContent)) ===
              expectedDocumentDigest
                ? "冻结文档正在被其他冻结流程确认"
                : "冻结文档内容与本次生成结果不一致",
          };
          const completedTab = await completeTabOperation(operation, {
            response,
            httpStatus: 409,
          });
          return NextResponse.json(
            { ...response, tabVersion: completedTab.version ?? 0 },
            { status: 409 }
          );
        }
        acquiredBinding = true;
        const frozenTabResult = await Tab.collection.updateOne(
          { _id: operationTab._id },
          {
            $set: { scope_frozen: true, freeze_status: "frozen" },
            $unset: { freeze_error: 1 },
          }
        );
        if (frozenTabResult.matchedCount !== 1) {
          throw new Error("冻结状态更新失败");
        }
        freezeStatePersisted = true;
        operationTab.scope_frozen = true;
        operationTab.freeze_status = "frozen";
        operationTab.freeze_error = undefined;
      } else {
        if (persistedFreezeState.freezeFilename) {
          await releaseFreezeDocumentBinding({
            projectId: project._id,
            filename: persistedFreezeState.freezeFilename,
            tabId: operationTab._id,
          });
        }
        await Tab.collection.updateOne(
          { _id: operationTab._id },
          {
            $set: { scope_frozen: false, freeze_status: "proposed" },
            $unset: {
              freeze_message_id: 1,
              freeze_filename: 1,
              freeze_document_digest: 1,
              freeze_error: 1,
            },
          }
        );
        operationTab.scope_frozen = false;
        operationTab.freeze_status = "proposed";
        operationTab.freeze_message_id = undefined;
        operationTab.freeze_filename = undefined;
        operationTab.freeze_document_digest = undefined;
        operationTab.freeze_error = undefined;
      }
      const response = freezeResponse(
        action === "complete"
          ? { freezeStatus: "frozen", scopeFrozen: true }
          : { freezeStatus: "proposed", scopeFrozen: false }
      );
      const completedTab = await completeTabOperation(operation, { response });
      return NextResponse.json({
        ...response,
        tabVersion: completedTab.version ?? 0,
      });
      } catch (error) {
        // 正式冻结状态已落库后，绑定就是最终文件事实。即使操作记录收尾失败，
        // 也不能把正式冻结文档重新暴露给 PATCH/DELETE 覆盖。
        if (
          acquiredBinding &&
          !freezeStatePersisted &&
          persistedFreezeState.freezeFilename
        ) {
          await releaseFreezeDocumentBinding({
            projectId: project._id,
            filename: persistedFreezeState.freezeFilename,
            tabId: operationTab._id,
          });
        }
        await failTabOperation(
        operation,
        error instanceof Error ? error.message : "冻结状态更新失败"
      );
      throw error;
    }
  } catch (error) {
    console.error("POST /api/tabs/[id]/freeze error:", error);
    return NextResponse.json({ error: "冻结状态更新失败" }, { status: 500 });
  }
}
