import type mongoose from "mongoose";
import ProjectFile from "@/models/ProjectFile";

export const FROZEN_DOCUMENT_LOCKED_MESSAGE =
  "冻结文档已正式锁定，不能修改";

type FreezeDocumentBinding = {
  tab_id: mongoose.Types.ObjectId;
  document_digest: string;
  locked_at: Date;
};

/**
 * 用文件当前完整内容作条件取得冻结绑定。文件 API 也以同一绑定作条件更新，
 * 因此“校验正文”和“阻止后续覆盖”在同一个 Mongo 文档原子操作中完成。
 */
export async function acquireFreezeDocumentBinding({
  projectId,
  filename,
  expectedContent,
  tabId,
  documentDigest,
}: {
  projectId: mongoose.Types.ObjectId;
  filename: string;
  expectedContent: string;
  tabId: mongoose.Types.ObjectId;
  documentDigest: string;
}): Promise<boolean> {
  const binding: FreezeDocumentBinding = {
    tab_id: tabId,
    document_digest: documentDigest,
    locked_at: new Date(),
  };
  const result = await ProjectFile.collection.updateOne(
    {
      project_id: projectId,
      filename,
      content: expectedContent,
      $or: [
        { freeze_binding: { $exists: false } },
        {
          "freeze_binding.tab_id": tabId,
          "freeze_binding.document_digest": documentDigest,
        },
      ],
    },
    { $set: { freeze_binding: binding } }
  );
  return result.matchedCount === 1;
}

/** 同一标签页在正式冻结前取消时释放仅属于自己的中间绑定。 */
export async function releaseFreezeDocumentBinding({
  projectId,
  filename,
  tabId,
}: {
  projectId: mongoose.Types.ObjectId;
  filename: string;
  tabId: mongoose.Types.ObjectId;
}): Promise<void> {
  await ProjectFile.collection.updateOne(
    {
      project_id: projectId,
      filename,
      "freeze_binding.tab_id": tabId,
    },
    { $unset: { freeze_binding: 1 } }
  );
}

/** 普通文件写入必须使用此条件，不能在已绑定冻结文档上静默覆盖。 */
export function mutableProjectFileFilter(fileId: mongoose.Types.ObjectId) {
  return {
    _id: fileId,
    $or: [{ freeze_binding: { $exists: false } }],
  };
}
