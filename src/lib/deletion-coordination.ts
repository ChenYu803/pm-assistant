import { randomUUID } from "node:crypto";
import mongoose, { type QueryFilter } from "mongoose";
import Project, { type IProjectDocument } from "@/models/Project";
import WorkRecord, { type IWorkRecordDocument } from "@/models/WorkRecord";
import Tab, { type ITabDocument } from "@/models/Tab";
import { reconcileCascadeOrphans } from "@/lib/cascade-orphan-cleanup";
import { parseObjectId } from "@/lib/ownership";

const DELETE_WAIT_TIMEOUT_MS = 30_000;
const DELETE_WAIT_INTERVAL_MS = 25;
const WRITE_LEASE_TTL_MS = 15_000;

type WriteLease = {
  release: () => Promise<void>;
  /** 长时间写入（例如流式聊天）必须续期，避免被当成异常退出的旧许可。 */
  renew: () => Promise<boolean>;
};

export type ProjectWriteLease = WriteLease & {
  project: IProjectDocument;
};

export type WorkRecordWriteLease = ProjectWriteLease & {
  workRecord: IWorkRecordDocument;
};

export type TabWriteLease = WorkRecordWriteLease & {
  tab: ITabDocument;
};

/** 兼容 v1.2 前创建、尚未补写删除状态的历史记录。 */
function activeDeletionFilter() {
  return {
    $or: [
      { deletion_state: "active" as const },
      { deletion_state: { $exists: false as const } },
    ],
  };
}

function deletableStateFilter() {
  return {
    $or: [
      { deletion_state: "active" as const },
      { deletion_state: "deleting" as const },
      { deletion_state: { $exists: false as const } },
    ],
  };
}

function onceRelease(release: () => Promise<void>): () => Promise<void> {
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await release();
  };
}

function nextLeaseExpiry() {
  return new Date(Date.now() + WRITE_LEASE_TTL_MS);
}

async function releaseProjectWriteLease(
  projectId: mongoose.Types.ObjectId,
  token: string
) {
  const result = await Project.updateOne(
    { _id: projectId },
    { $pull: { deletion_write_leases: { token } } }
  );
  if (result.matchedCount === 0) await reconcileCascadeOrphans();
}

async function renewProjectWriteLease(
  projectId: mongoose.Types.ObjectId,
  token: string
): Promise<boolean> {
  const result = await Project.updateOne(
    { _id: projectId, "deletion_write_leases.token": token },
    { $set: { "deletion_write_leases.$.expires_at": nextLeaseExpiry() } }
  );
  return result.matchedCount === 1;
}

async function releaseWorkRecordWriteLease(
  workRecordId: mongoose.Types.ObjectId,
  token: string
) {
  const result = await WorkRecord.updateOne(
    { _id: workRecordId },
    { $pull: { deletion_write_leases: { token } } }
  );
  if (result.matchedCount === 0) await reconcileCascadeOrphans();
}

async function renewWorkRecordWriteLease(
  workRecordId: mongoose.Types.ObjectId,
  token: string
): Promise<boolean> {
  const result = await WorkRecord.updateOne(
    { _id: workRecordId, "deletion_write_leases.token": token },
    { $set: { "deletion_write_leases.$.expires_at": nextLeaseExpiry() } }
  );
  return result.matchedCount === 1;
}

/**
 * 取得项目级写入许可。条件更新与许可登记是同一个 MongoDB 操作：删除一旦
 * 切到 deleting，之后的写入绝不会取得许可；此前已取得许可的请求会被删除等待。
 */
export async function acquireProjectWriteLease(
  projectId: string,
  userId: string
): Promise<ProjectWriteLease | null> {
  const projectObjectId = parseObjectId(projectId);
  if (!projectObjectId) return null;

  const token = randomUUID();
  const filter: QueryFilter<IProjectDocument> = {
    _id: projectObjectId,
    user_id: userId,
    ...activeDeletionFilter(),
  };
  const project = await Project.findOneAndUpdate(
    filter,
    {
      $push: {
        deletion_write_leases: { token, expires_at: nextLeaseExpiry() },
      },
    },
    { returnDocument: "after", lean: false }
  );
  if (!project) return null;

  return {
    project,
    release: onceRelease(() => releaseProjectWriteLease(project._id, token)),
    renew: () => renewProjectWriteLease(project._id, token),
  };
}

/** 为工作记录及其下属 tab 取得项目 + 工作记录两层写入许可。 */
export async function acquireWorkRecordWriteLease(
  workRecordId: string,
  userId: string
): Promise<WorkRecordWriteLease | null> {
  const workRecordObjectId = parseObjectId(workRecordId);
  if (!workRecordObjectId) return null;

  const initialWorkRecord = await WorkRecord.findById(workRecordObjectId).select(
    "project_id"
  );
  if (!initialWorkRecord) return null;

  const projectLease = await acquireProjectWriteLease(
    initialWorkRecord.project_id.toString(),
    userId
  );
  if (!projectLease) return null;

  try {
    const token = randomUUID();
    const filter: QueryFilter<IWorkRecordDocument> = {
      _id: workRecordObjectId,
      project_id: projectLease.project._id,
      ...activeDeletionFilter(),
    };
    const workRecord = await WorkRecord.findOneAndUpdate(
      filter,
      {
        $push: {
          deletion_write_leases: { token, expires_at: nextLeaseExpiry() },
        },
      },
      { returnDocument: "after", lean: false }
    );
    if (!workRecord) {
      await projectLease.release();
      return null;
    }

    return {
      project: projectLease.project,
      workRecord,
      release: onceRelease(async () => {
        await releaseWorkRecordWriteLease(workRecord._id, token);
        await projectLease.release();
      }),
      renew: async () => {
        const [workRecordRenewed, projectRenewed] = await Promise.all([
          renewWorkRecordWriteLease(workRecord._id, token),
          projectLease.renew(),
        ]);
        return workRecordRenewed && projectRenewed;
      },
    };
  } catch (error) {
    await projectLease.release();
    throw error;
  }
}

/** 为 tab 写入取得完整父级许可。 */
export async function acquireTabWriteLease(
  tabId: string,
  userId: string
): Promise<TabWriteLease | null> {
  const tabObjectId = parseObjectId(tabId);
  if (!tabObjectId) return null;

  const tab = await Tab.findById(tabObjectId);
  if (!tab) return null;

  const workRecordLease = await acquireWorkRecordWriteLease(
    tab.work_record_id.toString(),
    userId
  );
  if (!workRecordLease) return null;

  // 项目/工作记录许可已阻止父级被删除；tab 仍可能被用户单独删掉，因此再次确认。
  const currentTab = await Tab.findOne({
    _id: tab._id,
    work_record_id: workRecordLease.workRecord._id,
  });
  if (!currentTab) {
    await workRecordLease.release();
    return null;
  }

  return {
    ...workRecordLease,
    tab: currentTab,
  };
}

/** 将项目设为内部删除态；已在删除态的重复请求可继续补偿。 */
export async function beginProjectDeletion(
  projectId: string,
  userId: string
): Promise<IProjectDocument | null> {
  const projectObjectId = parseObjectId(projectId);
  if (!projectObjectId) return null;

  const filter: QueryFilter<IProjectDocument> = {
    _id: projectObjectId,
    user_id: userId,
    ...deletableStateFilter(),
  };
  return Project.findOneAndUpdate(
    filter,
    { $set: { deletion_state: "deleting", deletion_started_at: new Date() } },
    { returnDocument: "after", lean: false }
  );
}

/**
 * 工作记录删除也持有项目写入许可。这样项目删除即使随后开始，也会先等此删除
 * 完成，避免两个级联清理在父级边界上交叉。
 */
export async function beginWorkRecordDeletion(
  workRecordId: string,
  userId: string
): Promise<(ProjectWriteLease & { workRecord: IWorkRecordDocument }) | null> {
  const workRecordObjectId = parseObjectId(workRecordId);
  if (!workRecordObjectId) return null;

  const initialWorkRecord = await WorkRecord.findById(workRecordObjectId).select(
    "project_id"
  );
  if (!initialWorkRecord) return null;

  const projectLease = await acquireProjectWriteLease(
    initialWorkRecord.project_id.toString(),
    userId
  );
  if (!projectLease) return null;

  try {
    const filter: QueryFilter<IWorkRecordDocument> = {
      _id: workRecordObjectId,
      project_id: projectLease.project._id,
      ...deletableStateFilter(),
    };
    const workRecord = await WorkRecord.findOneAndUpdate(
      filter,
      { $set: { deletion_state: "deleting", deletion_started_at: new Date() } },
      { returnDocument: "after", lean: false }
    );
    if (!workRecord) {
      await projectLease.release();
      return null;
    }
    return { ...projectLease, workRecord };
  } catch (error) {
    await projectLease.release();
    throw error;
  }
}

async function waitForNoWrites(
  collection: typeof Project.collection | typeof WorkRecord.collection,
  id: mongoose.Types.ObjectId,
  label: string,
  removeExpiredLeases: () => Promise<unknown>
) {
  const deadline = Date.now() + DELETE_WAIT_TIMEOUT_MS;
  while (true) {
    // 进程或请求在取得许可后异常退出时没有 finally 可执行。删除端主动清除
    // 已过期的具体许可，重试就不会永久卡在一个无法归还的许可上。
    await removeExpiredLeases();
    const document = await collection.findOne(
      { _id: id },
      { projection: { deletion_write_leases: 1 } }
    );
    if (!document || (document.deletion_write_leases?.length ?? 0) === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(`等待${label}中的写入完成超时`);
    }
    await new Promise((resolve) => setTimeout(resolve, DELETE_WAIT_INTERVAL_MS));
  }
}

export async function waitForProjectWritesToFinish(
  projectId: mongoose.Types.ObjectId
) {
  await waitForNoWrites(Project.collection, projectId, "项目", () =>
    Project.updateOne(
      { _id: projectId },
      { $pull: { deletion_write_leases: { expires_at: { $lte: new Date() } } } }
    )
  );
}

export async function waitForWorkRecordWritesToFinish(
  workRecordId: mongoose.Types.ObjectId
) {
  await waitForNoWrites(WorkRecord.collection, workRecordId, "工作记录", () =>
    WorkRecord.updateOne(
      { _id: workRecordId },
      { $pull: { deletion_write_leases: { expires_at: { $lte: new Date() } } } }
    )
  );
}

/** 仅供 replay 验证制造一个已取得许可、尚未落库的写入窗口。 */
export async function pauseWriteLeaseForTest(request: Request) {
  if (
    process.env.CASCADE_DELETE_TEST_HOOKS === "1" &&
    request.headers.get("x-pm-assistant-test-write-lease-pause") === "1"
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
