import mongoose, { type ClientSession } from "mongoose";
import AgentFileContext from "@/models/AgentFileContext";
import Message from "@/models/Message";
import Project from "@/models/Project";
import ProjectFile from "@/models/ProjectFile";
import PrototypeSnapshot from "@/models/PrototypeSnapshot";
import Tab from "@/models/Tab";
import TabOperation from "@/models/TabOperation";
import WorkRecord from "@/models/WorkRecord";

export const CASCADE_DELETE_TEST_STEPS = [
  "agent-file-contexts",
  "messages",
  "tab-operations",
  "tabs",
  "work-records",
  "project-files",
  "prototype-snapshots",
] as const;

type CascadeDeleteStep = (typeof CASCADE_DELETE_TEST_STEPS)[number];

export interface CascadeDeleteOptions {
  forceCompensation?: boolean;
  failAfterStep?: CascadeDeleteStep;
}

export interface CascadeDeleteResult {
  mode: "transaction" | "compensation";
}

type CascadeExecutor = (session?: ClientSession) => Promise<void>;

function sessionOptions(session?: ClientSession) {
  return session ? { session } : undefined;
}

function isTransactionUnsupported(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  const message = error instanceof Error ? error.message : String(error);

  return (
    code === 20 &&
    /(transaction numbers are only allowed|transactions?.*not supported|replica set member or mongos)/i.test(
      message
    )
  );
}

function testOptions(request: Request): CascadeDeleteOptions {
  // 测试钩子必须在启动服务时显式打开，普通开发和生产请求都不会读取该头。
  if (process.env.CASCADE_DELETE_TEST_HOOKS !== "1") return {};

  const failAfterStep = request.headers.get(
    "x-pm-assistant-test-cascade-fail-after"
  );
  return {
    forceCompensation:
      request.headers.get("x-pm-assistant-test-force-compensation") === "1",
    failAfterStep: CASCADE_DELETE_TEST_STEPS.includes(
      failAfterStep as CascadeDeleteStep
    )
      ? (failAfterStep as CascadeDeleteStep)
      : undefined,
  };
}

export function getCascadeDeleteTestOptions(request: Request): CascadeDeleteOptions {
  return testOptions(request);
}

function injectTestFailure(
  step: CascadeDeleteStep,
  options: CascadeDeleteOptions
): void {
  if (options.failAfterStep === step) {
    throw new Error(`级联删除测试故障：${step} 已清理`);
  }
}

async function cleanCollection(
  label: string,
  step: CascadeDeleteStep,
  remove: () => Promise<unknown>,
  remaining: () => Promise<number>,
  options: CascadeDeleteOptions
): Promise<void> {
  await remove();
  const count = await remaining();
  if (count !== 0) {
    throw new Error(`${label} 清理未完成，剩余 ${count} 条记录`);
  }
  injectTestFailure(step, options);
}

async function runCascade(
  executor: CascadeExecutor,
  options: CascadeDeleteOptions
): Promise<CascadeDeleteResult> {
  if (!options.forceCompensation) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await executor(session);
      });
      return { mode: "transaction" };
    } catch (error) {
      if (!isTransactionUnsupported(error)) throw error;
    } finally {
      await session.endSession();
    }
  }

  await executor();
  return { mode: "compensation" };
}

async function clearTabOwnedData(
  tabIds: mongoose.Types.ObjectId[],
  session: ClientSession | undefined,
  options: CascadeDeleteOptions
): Promise<void> {
  const tabFilter = { tab_id: { $in: tabIds } };
  const optionsWithSession = sessionOptions(session);

  await cleanCollection(
    "文件上下文",
    "agent-file-contexts",
    () => AgentFileContext.deleteMany(tabFilter, optionsWithSession),
    () => AgentFileContext.countDocuments(tabFilter, optionsWithSession),
    options
  );
  await cleanCollection(
    "消息",
    "messages",
    () => Message.deleteMany(tabFilter, optionsWithSession),
    () => Message.countDocuments(tabFilter, optionsWithSession),
    options
  );
  await cleanCollection(
    "标签页操作记录",
    "tab-operations",
    () => TabOperation.deleteMany(tabFilter, optionsWithSession),
    () => TabOperation.countDocuments(tabFilter, optionsWithSession),
    options
  );
}

/**
 * 删除单个工作记录的 tab 级数据。项目文件和项目级快照不属于工作记录，必须保留。
 */
export async function deleteWorkRecordCascade(
  workRecordId: mongoose.Types.ObjectId,
  options: CascadeDeleteOptions = {}
): Promise<CascadeDeleteResult> {
  return runCascade(async (session) => {
    const optionsWithSession = sessionOptions(session);
    const tabIds = await Tab.distinct(
      "_id",
      { work_record_id: workRecordId },
      optionsWithSession
    );
    await clearTabOwnedData(tabIds, session, options);

    const tabFilter = { _id: { $in: tabIds } };
    await cleanCollection(
      "标签页",
      "tabs",
      () => Tab.deleteMany(tabFilter, optionsWithSession),
      () => Tab.countDocuments(tabFilter, optionsWithSession),
      options
    );

    const workRecordFilter = { _id: workRecordId };
    await WorkRecord.deleteOne(workRecordFilter, optionsWithSession);
    const remaining = await WorkRecord.countDocuments(
      workRecordFilter,
      optionsWithSession
    );
    if (remaining !== 0) {
      throw new Error(`工作记录清理未完成，剩余 ${remaining} 条记录`);
    }
  }, options);
}

/**
 * 删除项目及其全部下属数据。补偿路径永远先删子集合、最后删项目，因此失败后
 * 原项目仍是可定位的重试入口；已完成的子集合删除可安全重复执行。
 */
export async function deleteProjectCascade(
  projectId: mongoose.Types.ObjectId,
  options: CascadeDeleteOptions = {}
): Promise<CascadeDeleteResult> {
  return runCascade(async (session) => {
    const optionsWithSession = sessionOptions(session);
    const workRecordIds = await WorkRecord.distinct(
      "_id",
      { project_id: projectId },
      optionsWithSession
    );
    const tabIds = await Tab.distinct(
      "_id",
      { work_record_id: { $in: workRecordIds } },
      optionsWithSession
    );
    await clearTabOwnedData(tabIds, session, options);

    const tabFilter = { _id: { $in: tabIds } };
    await cleanCollection(
      "标签页",
      "tabs",
      () => Tab.deleteMany(tabFilter, optionsWithSession),
      () => Tab.countDocuments(tabFilter, optionsWithSession),
      options
    );

    const workRecordFilter = { _id: { $in: workRecordIds } };
    await cleanCollection(
      "工作记录",
      "work-records",
      () => WorkRecord.deleteMany(workRecordFilter, optionsWithSession),
      () => WorkRecord.countDocuments(workRecordFilter, optionsWithSession),
      options
    );

    const projectFilter = { project_id: projectId };
    await cleanCollection(
      "项目文件",
      "project-files",
      () => ProjectFile.deleteMany(projectFilter, optionsWithSession),
      () => ProjectFile.countDocuments(projectFilter, optionsWithSession),
      options
    );
    await cleanCollection(
      "原型快照",
      "prototype-snapshots",
      () => PrototypeSnapshot.deleteMany(projectFilter, optionsWithSession),
      () => PrototypeSnapshot.countDocuments(projectFilter, optionsWithSession),
      options
    );

    const projectFilterById = { _id: projectId };
    await Project.deleteOne(projectFilterById, optionsWithSession);
    const remaining = await Project.countDocuments(
      projectFilterById,
      optionsWithSession
    );
    if (remaining !== 0) {
      throw new Error(`项目清理未完成，剩余 ${remaining} 条记录`);
    }
  }, options);
}
