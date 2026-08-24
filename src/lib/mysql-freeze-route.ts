import { NextResponse } from "next/server";

import {
  MYSQL_TAB_CONFLICT_MESSAGE,
  beginMysqlTabOperation,
  completeMysqlTabOperation,
  failMysqlTabOperation,
  parseMysqlTabMutationRequest,
  waitForMysqlTabOperation,
} from "@/lib/mysql-tab-concurrency";
import { performMysqlFreezeAction } from "@/lib/mysql-freeze";
import { findOwnedMysqlConversationTab } from "@/lib/mysql-conversation";

type FreezeAction = "cancel" | "complete";

function conflict(currentVersion: number | null) {
  return NextResponse.json(
    { error: MYSQL_TAB_CONFLICT_MESSAGE, code: "TAB_VERSION_CONFLICT", currentVersion },
    { status: 409 }
  );
}

function actionError(kind: Exclude<Awaited<ReturnType<typeof performMysqlFreezeAction>>["kind"], "completed">) {
  if (kind === "not-found") return { error: "标签页不存在或无权操作", status: 404 };
  if (kind === "invalid-state") return { error: "当前没有待确认写入的冻结文档", status: 409 };
  if (kind === "missing-document") return { error: "冻结文档尚未写入项目", status: 409 };
  if (kind === "mismatched-document") return { error: "冻结文档内容与本次生成结果不一致", status: 409 };
  return { error: "冻结文档正在被其他冻结流程确认", status: 409 };
}

export async function postMysqlFreezeRoute(tabId: string, userId: string, body: Record<string, unknown>) {
  const mutation = parseMysqlTabMutationRequest(body);
  const action = body.action as FreezeAction | undefined;
  if (!mutation || (action !== "cancel" && action !== "complete")) {
    return NextResponse.json({ error: "冻结操作参数无效" }, { status: 400 });
  }
  const tab = await findOwnedMysqlConversationTab(tabId, userId);
  if (!tab) return NextResponse.json({ error: "标签页不存在或无权操作" }, { status: 404 });
  const started = await beginMysqlTabOperation({
    tabId,
    userId,
    operation: `freeze-${action}`,
    request: mutation,
  });
  if (started.kind === "not-found") return NextResponse.json({ error: "标签页不存在或无权操作" }, { status: 404 });
  if (started.kind === "request-id-mismatch") return NextResponse.json({ error: "请求标识已用于其他操作" }, { status: 409 });
  if (started.kind === "conflict") return conflict(started.currentVersion);
  if (started.kind === "replay") {
    const replay = await waitForMysqlTabOperation(started.operation);
    if (replay.status === "conflict") return conflict(replay.tab_version);
    const response = typeof replay.response_json === "object" && replay.response_json ? replay.response_json : null;
    return response
      ? NextResponse.json({ ...response, tabVersion: replay.tab_version }, { status: Number(response.httpStatus ?? 200) })
      : NextResponse.json({ error: "请求正在处理中，请稍后重试" }, { status: 409 });
  }
  try {
    const result = await performMysqlFreezeAction({ tabId, userId, action, operation: started.operation });
    if (result.kind === "completed") {
      return NextResponse.json({ freezeStatus: result.freezeStatus, scopeFrozen: result.scopeFrozen, tabVersion: result.tabVersion });
    }
    const failure = actionError(result.kind);
    const tabVersion = await completeMysqlTabOperation(started.operation, {
      error: failure.error,
      httpStatus: failure.status,
    });
    return NextResponse.json({ error: failure.error, tabVersion }, { status: failure.status });
  } catch (error) {
    await failMysqlTabOperation(started.operation, error instanceof Error ? error.message : "冻结状态更新失败");
    throw error;
  }
}
