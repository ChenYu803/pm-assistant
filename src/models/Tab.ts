import mongoose, { Document, Model } from "mongoose";
import {
  AGENT_TYPES,
  FREEZE_STATUSES,
  type AgentType,
  type FreezeStatus,
} from "@/lib/agent-constants";

interface ITab {
  agent_type: AgentType;
  display_name: string;
  position: number;
  work_record_id: mongoose.Types.ObjectId;
  scope_frozen: boolean;
  version: number;
  active_operation_id?: string;
  freeze_status: FreezeStatus;
  freeze_message_id?: mongoose.Types.ObjectId;
  freeze_filename?: string;
  freeze_document_digest?: string;
  freeze_error?: string;
  created_at: Date;
}

export interface ITabDocument extends ITab, Document {
  _id: mongoose.Types.ObjectId;
}

const TabSchema = new mongoose.Schema<ITabDocument>(
  {
    agent_type: {
      type: String,
      required: true,
      enum: AGENT_TYPES,
    },
    display_name: {
      type: String,
      required: true,
      trim: true,
    },
    position: {
      type: Number,
      required: true,
      default: 0,
    },
    work_record_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkRecord",
      required: true,
      index: true,
    },
    scope_frozen: {
      type: Boolean,
      default: false,
    },
    // 乐观并发控制的显式版本；缺失的历史数据按 0 处理。
    version: {
      type: Number,
      default: 0,
      min: 0,
    },
    // 长时间流式操作持有标签页，避免另一窗口在生成尚未提交时插入写入。
    active_operation_id: {
      type: String,
    },
    freeze_status: {
      type: String,
      enum: FREEZE_STATUSES,
      default: "idle",
    },
    freeze_message_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    freeze_filename: {
      type: String,
    },
    freeze_document_digest: {
      type: String,
    },
    freeze_error: {
      type: String,
    },
    created_at: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    collection: "tabs",
  }
);

const existingTab = mongoose.models.Tab as Model<ITabDocument> | undefined;

// next dev 会在热更新时复用已注册的 Mongoose model。补齐新增路径，避免
// 仍在运行的开发服务静默丢弃并发或冻结状态字段。
if (existingTab) {
  const addedPaths: Record<string, unknown> = {};
  if (!existingTab.schema.path("version")) {
    addedPaths.version = { type: Number, default: 0, min: 0 };
  }
  if (!existingTab.schema.path("active_operation_id")) {
    addedPaths.active_operation_id = { type: String };
  }
  if (!existingTab.schema.path("freeze_status")) {
    addedPaths.freeze_status = {
      type: String,
      enum: FREEZE_STATUSES,
      default: "idle",
    };
  }
  if (!existingTab.schema.path("freeze_message_id")) {
    addedPaths.freeze_message_id = {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    };
  }
  if (!existingTab.schema.path("freeze_filename")) {
    addedPaths.freeze_filename = { type: String };
  }
  if (!existingTab.schema.path("freeze_document_digest")) {
    addedPaths.freeze_document_digest = { type: String };
  }
  if (!existingTab.schema.path("freeze_error")) {
    addedPaths.freeze_error = { type: String };
  }
  if (Object.keys(addedPaths).length > 0) {
    existingTab.schema.add(addedPaths);
  }
}

const Tab: Model<ITabDocument> =
  existingTab ?? mongoose.model<ITabDocument>("Tab", TabSchema);

export default Tab;
