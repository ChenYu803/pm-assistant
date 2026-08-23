import mongoose from "mongoose";

const ORPHAN_BATCH_SIZE = 500;
const PROJECT_LIST_RECONCILE_INTERVAL_MS = 60_000;

type OrphanStep = {
  collection: string;
  parentCollection: string;
  parentField: string;
};

// 父级先于迟到写入被物理删除时，按 ownership 链从上到下补扫。
const ORPHAN_STEPS: OrphanStep[] = [
  { collection: "project_files", parentCollection: "projects", parentField: "project_id" },
  { collection: "prototype_snapshots", parentCollection: "projects", parentField: "project_id" },
  { collection: "work_records", parentCollection: "projects", parentField: "project_id" },
  { collection: "tabs", parentCollection: "work_records", parentField: "work_record_id" },
  { collection: "agent_file_contexts", parentCollection: "tabs", parentField: "tab_id" },
  { collection: "messages", parentCollection: "tabs", parentField: "tab_id" },
  { collection: "tab_operations", parentCollection: "tabs", parentField: "tab_id" },
];

let activeReconciliation: Promise<number> | null = null;
let lastProjectListReconciliationAt = 0;

async function removeOrphans(step: OrphanStep): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB 尚未连接，无法清扫级联残留");

  const collection = db.collection(step.collection);
  const orphanIds = await collection
    .aggregate<{ _id: mongoose.Types.ObjectId }>([
      {
        $lookup: {
          from: step.parentCollection,
          localField: step.parentField,
          foreignField: "_id",
          as: "parent",
        },
      },
      { $match: { parent: { $eq: [] } } },
      { $limit: ORPHAN_BATCH_SIZE },
      { $project: { _id: 1 } },
    ])
    .toArray();
  if (orphanIds.length === 0) return 0;

  const result = await collection.deleteMany({
    _id: { $in: orphanIds.map((orphan) => orphan._id) },
  });
  return result.deletedCount;
}

async function runCascadeOrphanCleanup(): Promise<number> {
  let deletedCount = 0;

  // 一轮顺序清扫即可覆盖现有 ownership 链；第二轮处理同一时刻迟到的写入。
  for (let pass = 0; pass < 2; pass += 1) {
    let passDeletedCount = 0;
    for (const step of ORPHAN_STEPS) {
      passDeletedCount += await removeOrphans(step);
    }
    deletedCount += passDeletedCount;
    if (passDeletedCount === 0) break;
  }

  return deletedCount;
}

/** 可重入的最终清理：只删除父级已经不存在的内部残留。 */
export async function reconcileCascadeOrphans(): Promise<number> {
  if (!activeReconciliation) {
    activeReconciliation = runCascadeOrphanCleanup().finally(() => {
      activeReconciliation = null;
    });
  }
  return activeReconciliation;
}

/** 本地应用重新打开项目列表时补扫；一分钟内不重复全库扫描。 */
export async function reconcileCascadeOrphansForProjectList(
  force = false
): Promise<void> {
  if (
    !force &&
    Date.now() - lastProjectListReconciliationAt < PROJECT_LIST_RECONCILE_INTERVAL_MS
  ) {
    return;
  }
  lastProjectListReconciliationAt = Date.now();
  await reconcileCascadeOrphans();
}
