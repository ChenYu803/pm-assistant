import type { ITabDocument } from "@/models/Tab";
import Tab from "@/models/Tab";
import TabOperation, {
  type ITabOperationDocument,
  type TabOperationResult,
} from "@/models/TabOperation";

export const TAB_CONFLICT_MESSAGE = "此标签页正在被其他窗口修改";

export interface TabMutationRequest {
  expectedVersion: number;
  requestId: string;
}

export type TabOperationStart =
  | {
      kind: "claimed";
      tab: ITabDocument;
      operation: ITabOperationDocument;
    }
  | { kind: "replay"; operation: ITabOperationDocument }
  | { kind: "conflict"; currentVersion: number | null }
  | { kind: "request-id-mismatch" };

function isDuplicateRequestIdError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

function versionFilter(expectedVersion: number) {
  return expectedVersion === 0
    ? { $or: [{ version: 0 }, { version: { $exists: false } }] }
    : { version: expectedVersion };
}

function unlockedFilter() {
  return {
    $or: [
      { active_operation_id: { $exists: false } },
      { active_operation_id: null },
    ],
  };
}

function nextTimestamp(): Date {
  return new Date();
}

/** 校验所有会改变标签页事实的请求都带有同一套并发字段。 */
export function parseTabMutationRequest(
  value: unknown
): TabMutationRequest | null {
  if (!value || typeof value !== "object") return null;
  const { expectedVersion, requestId } = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(expectedVersion) ||
    typeof expectedVersion !== "number" ||
    expectedVersion < 0 ||
    expectedVersion >= Number.MAX_SAFE_INTEGER ||
    typeof requestId !== "string" ||
    !requestId.trim() ||
    requestId.length > 160
  ) {
    return null;
  }
  return { expectedVersion, requestId: requestId.trim() };
}

async function getExistingOperation(
  tab: ITabDocument,
  requestId: string,
  operation: string
): Promise<TabOperationStart | null> {
  const existing = await TabOperation.findOne({
    tab_id: tab._id,
    request_id: requestId,
  });
  if (!existing) return null;
  if (existing.operation !== operation) return { kind: "request-id-mismatch" };
  return { kind: "replay", operation: existing };
}

/**
 * 领取一个会改变标签页事实的操作。领取成功后 tab 保持锁定直到调用
 * completeTabOperation 或 failTabOperation，其他窗口只能得到明确冲突。
 */
export async function beginTabOperation({
  tab,
  operation,
  request,
}: {
  tab: ITabDocument;
  operation: string;
  request: TabMutationRequest;
}): Promise<TabOperationStart> {
  const existing = await getExistingOperation(tab, request.requestId, operation);
  if (existing) return existing;

  let operationRecord: ITabOperationDocument;
  try {
    operationRecord = await TabOperation.create({
      tab_id: tab._id,
      request_id: request.requestId,
      operation,
      expected_version: request.expectedVersion,
      status: "pending",
    });
  } catch (error) {
    if (!isDuplicateRequestIdError(error)) throw error;
    const replay = await getExistingOperation(tab, request.requestId, operation);
    if (replay) return replay;
    throw error;
  }

  const claimedTab = await Tab.findOneAndUpdate(
    {
      _id: tab._id,
      $and: [versionFilter(request.expectedVersion), unlockedFilter()],
    },
    {
      $inc: { version: 1 },
      $set: { active_operation_id: request.requestId },
    },
    { new: true }
  );
  if (!claimedTab) {
    const current = await Tab.findById(tab._id).select({ version: 1 }).lean();
    await TabOperation.updateOne(
      { _id: operationRecord._id },
      {
        $set: {
          status: "conflict",
          result: { tabVersion: current?.version ?? 0 },
          updated_at: nextTimestamp(),
        },
      }
    );
    return { kind: "conflict", currentVersion: current?.version ?? null };
  }

  // 条件更新已证明当前版本等于 expectedVersion，因此锁定版本可由请求
  // 确定计算；不依赖热更新期间 Mongoose 旧 schema 的返回文档投影。
  operationRecord.locked_version = request.expectedVersion + 1;
  operationRecord.status = "processing";
  operationRecord.updated_at = nextTimestamp();
  await operationRecord.save();
  return { kind: "claimed", tab: claimedTab, operation: operationRecord };
}

/**
 * 只校验版本、不抢占当前流式锁的操作。停止生成属于此类：它必须能中断
 * 正在持有标签页的同一条生成，但不能让另一条写入越过该锁。
 */
export async function beginPassiveTabOperation({
  tab,
  operation,
  request,
}: {
  tab: ITabDocument;
  operation: string;
  request: TabMutationRequest;
}): Promise<TabOperationStart> {
  const existing = await getExistingOperation(tab, request.requestId, operation);
  if (existing) return existing;

  let operationRecord: ITabOperationDocument;
  try {
    operationRecord = await TabOperation.create({
      tab_id: tab._id,
      request_id: request.requestId,
      operation,
      expected_version: request.expectedVersion,
      status: "pending",
    });
  } catch (error) {
    if (!isDuplicateRequestIdError(error)) throw error;
    const replay = await getExistingOperation(tab, request.requestId, operation);
    if (replay) return replay;
    throw error;
  }

  const currentTab = await Tab.findOne({
    _id: tab._id,
    ...versionFilter(request.expectedVersion),
  });
  if (!currentTab) {
    const current = await Tab.findById(tab._id).select({ version: 1 }).lean();
    await TabOperation.updateOne(
      { _id: operationRecord._id },
      {
        $set: {
          status: "conflict",
          result: { tabVersion: current?.version ?? 0 },
          updated_at: nextTimestamp(),
        },
      }
    );
    return { kind: "conflict", currentVersion: current?.version ?? null };
  }

  operationRecord.locked_version = request.expectedVersion;
  operationRecord.status = "processing";
  operationRecord.updated_at = nextTimestamp();
  await operationRecord.save();
  return { kind: "claimed", tab: currentTab, operation: operationRecord };
}

/** 同一 requestId 极短暂地并发到达时，等待首个请求写入可重放结果。 */
export async function waitForTabOperation(
  operation: ITabOperationDocument,
  attempts = 40
): Promise<ITabOperationDocument> {
  let current = operation;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (
      current.result ||
      current.status === "completed" ||
      current.status === "conflict" ||
      current.status === "failed"
    ) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    const refreshed = await TabOperation.findById(operation._id);
    if (!refreshed) return current;
    current = refreshed;
  }
  return current;
}

export async function recordTabOperationResult(
  operation: ITabOperationDocument,
  result: TabOperationResult
): Promise<void> {
  await TabOperation.updateOne(
    { _id: operation._id },
    {
      $set: {
        result,
        updated_at: nextTimestamp(),
      },
    }
  );
}

/** 结束独占操作，释放 tab 并将最终版本写入可重放结果。 */
export async function completeTabOperation(
  operation: ITabOperationDocument,
  result: TabOperationResult
): Promise<ITabDocument> {
  if (operation.locked_version === undefined) {
    throw new Error("标签页操作缺少锁定版本");
  }
  const tab = await Tab.findOneAndUpdate(
    {
      _id: operation.tab_id,
      version: operation.locked_version,
      active_operation_id: operation.request_id,
    },
    {
      $inc: { version: 1 },
      $unset: { active_operation_id: 1 },
    },
    { new: true }
  );
  if (!tab) {
    throw new Error("标签页并发状态异常，无法完成操作");
  }
  const finalVersion = operation.locked_version + 1;
  tab.version = finalVersion;
  await TabOperation.updateOne(
    { _id: operation._id },
    {
      $set: {
        status: "completed",
        result: { ...result, tabVersion: finalVersion },
        updated_at: nextTimestamp(),
      },
    }
  );
  return tab;
}

/** 操作失败也必须释放锁，否则之后的用户操作会永久冲突。 */
export async function failTabOperation(
  operation: ITabOperationDocument,
  error: string
): Promise<ITabDocument | null> {
  if (operation.locked_version === undefined) return null;
  const tab = await Tab.findOneAndUpdate(
    {
      _id: operation.tab_id,
      version: operation.locked_version,
      active_operation_id: operation.request_id,
    },
    {
      $inc: { version: 1 },
      $unset: { active_operation_id: 1 },
    },
    { new: true }
  );
  const finalVersion = operation.locked_version + 1;
  if (tab) tab.version = finalVersion;
  await TabOperation.updateOne(
    { _id: operation._id },
    {
      $set: {
        status: "failed",
        result: { error, tabVersion: tab ? finalVersion : 0 },
        updated_at: nextTimestamp(),
      },
    }
  );
  return tab;
}

export async function completePassiveTabOperation(
  operation: ITabOperationDocument,
  result: TabOperationResult
): Promise<void> {
  await TabOperation.updateOne(
    { _id: operation._id },
    {
      $set: {
        status: "completed",
        result,
        updated_at: nextTimestamp(),
      },
    }
  );
}
