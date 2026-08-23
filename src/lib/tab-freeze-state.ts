import type mongoose from "mongoose";
import { FREEZE_STATUSES, type FreezeStatus } from "@/lib/agent-constants";
import Tab from "@/models/Tab";

export interface PersistedFreezeState {
  version: number;
  scopeFrozen: boolean;
  freezeStatus: FreezeStatus;
  freezeMessageId?: string;
  freezeFilename?: string;
  freezeDocumentDigest?: string;
  freezeError?: string;
}

const FREEZE_STATUS_SET = new Set<FreezeStatus>(FREEZE_STATUSES);

/**
 * Next dev 热更新会复用旧的 Mongoose model，新增 schema 路径可能不会被旧
 * document 投影出来。冻结状态和版本都是并发协议的事实源，因此直接读取 collection。
 */
export async function getPersistedFreezeState(
  tabId: mongoose.Types.ObjectId
): Promise<PersistedFreezeState> {
  const tab = await Tab.collection.findOne(
    { _id: tabId },
    {
      projection: {
        scope_frozen: 1,
        version: 1,
        freeze_status: 1,
        freeze_message_id: 1,
        freeze_filename: 1,
        freeze_document_digest: 1,
        freeze_error: 1,
      },
    }
  );
  const scopeFrozen = tab?.scope_frozen === true;
  const version =
    typeof tab?.version === "number" && Number.isSafeInteger(tab.version)
      ? tab.version
      : 0;
  const candidateStatus = tab?.freeze_status;
  const freezeStatus = scopeFrozen
    ? "frozen"
    : typeof candidateStatus === "string" &&
        FREEZE_STATUS_SET.has(candidateStatus as FreezeStatus)
      ? (candidateStatus as FreezeStatus)
      : "idle";

  return {
    version,
    scopeFrozen,
    freezeStatus,
    ...(tab?.freeze_message_id
      ? { freezeMessageId: tab.freeze_message_id.toString() }
      : {}),
    ...(typeof tab?.freeze_filename === "string"
      ? { freezeFilename: tab.freeze_filename }
      : {}),
    ...(typeof tab?.freeze_document_digest === "string"
      ? { freezeDocumentDigest: tab.freeze_document_digest }
      : {}),
    ...(typeof tab?.freeze_error === "string"
      ? { freezeError: tab.freeze_error }
      : {}),
  };
}
