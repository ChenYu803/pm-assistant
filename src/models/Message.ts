import mongoose, { Document, Model } from "mongoose";

export const MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const ASSISTANT_MESSAGE_STATUSES = [
  "generating",
  "completed",
  "interrupted",
  "failed",
] as const;
export type AssistantMessageStatus = (typeof ASSISTANT_MESSAGE_STATUSES)[number];

export const MESSAGE_REPLACEMENT_KINDS = [
  "regenerate",
  "edit",
  "retry",
] as const;
export type MessageReplacementKind =
  (typeof MESSAGE_REPLACEMENT_KINDS)[number];

interface IMessage {
  role: MessageRole;
  content: string;
  timestamp: Date;
  tab_id: mongoose.Types.ObjectId;
  status?: AssistantMessageStatus;
  error_message?: string;
  request_id?: string;
  replacement_target_id?: mongoose.Types.ObjectId;
  replacement_commit_message_id?: mongoose.Types.ObjectId;
  superseded_by_message_id?: mongoose.Types.ObjectId;
  replacement_committed?: boolean;
  replacement_kind?: MessageReplacementKind;
  replacement_user_message_id?: mongoose.Types.ObjectId;
  // 新消息显式标记已启用消息级文件来源协议；缺失字段只代表升级前历史消息。
  file_provenance_version?: number;
}

export interface IMessageDocument extends IMessage, Document {
  _id: mongoose.Types.ObjectId;
}

const MessageSchema = new mongoose.Schema<IMessageDocument>(
  {
    role: {
      type: String,
      required: true,
      enum: MESSAGE_ROLES,
    },
    content: {
      type: String,
      // 生成开始时 assistant 先落一条正式消息；零 token 失败允许其内容为空。
      required: function (this: IMessageDocument) {
        return this.role !== "assistant";
      },
    },
    timestamp: {
      type: Date,
      default: () => new Date(),
    },
    tab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tab",
      required: true,
    },
    status: {
      type: String,
      enum: ASSISTANT_MESSAGE_STATUSES,
    },
    error_message: {
      type: String,
    },
    request_id: {
      type: String,
    },
    replacement_target_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    replacement_commit_message_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    superseded_by_message_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    replacement_committed: {
      type: Boolean,
      default: false,
    },
    replacement_kind: {
      type: String,
      enum: MESSAGE_REPLACEMENT_KINDS,
    },
    replacement_user_message_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    file_provenance_version: {
      type: Number,
    },
  },
  {
    collection: "messages",
  }
);

// Compound index for efficient message retrieval ordered by time
MessageSchema.index({ tab_id: 1, timestamp: 1 });
MessageSchema.index(
  { tab_id: 1, request_id: 1 },
  {
    unique: true,
    partialFilterExpression: { request_id: { $type: "string" } },
  }
);

const existingMessage = mongoose.models.Message as
  | Model<IMessageDocument>
  | undefined;

// Next dev 热更新会复用已注册 model；补齐来源协议字段，避免新消息被当成历史消息。
if (existingMessage && !existingMessage.schema.path("file_provenance_version")) {
  existingMessage.schema.add({ file_provenance_version: { type: Number } });
}

const Message: Model<IMessageDocument> =
  existingMessage ?? mongoose.model<IMessageDocument>("Message", MessageSchema);

type MessageIndexGlobal = typeof globalThis & {
  messageRequestIdIndexPromise?: Promise<void>;
};

const messageIndexGlobal = globalThis as MessageIndexGlobal;
const REQUEST_ID_INDEX_NAME = "tab_id_1_request_id_1";
const REQUEST_ID_INDEX_OPTIONS = {
  name: REQUEST_ID_INDEX_NAME,
  unique: true,
  partialFilterExpression: { request_id: { $type: "string" } },
} as const;

function isMongoErrorCode(error: unknown, codes: number[]): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number" &&
    codes.includes(error.code)
  );
}

async function clearDuplicateRequestIds(): Promise<number> {
  const duplicateGroups = await Message.collection
    .aggregate<{
      ids: mongoose.Types.ObjectId[];
    }>([
      { $match: { request_id: { $type: "string" } } },
      { $sort: { tab_id: 1, request_id: 1, timestamp: 1, _id: 1 } },
      {
        $group: {
          _id: { tab_id: "$tab_id", request_id: "$request_id" },
          ids: { $push: "$_id" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  let cleared = 0;
  for (const group of duplicateGroups) {
    const duplicateIds = group.ids.slice(1);
    if (duplicateIds.length === 0) continue;
    const result = await Message.updateMany(
      { _id: { $in: duplicateIds } },
      { $unset: { request_id: 1 } }
    );
    cleared += result.modifiedCount;
  }
  return cleared;
}

/**
 * 确保 requestId 在单个标签页内真正由 Mongo 唯一索引约束。
 *
 * 旧版本曾在没有索引时写入重复 requestId。迁移只移除较晚消息的幂等标识，
 * 不删除或改写任何消息内容；旧请求标识本就仅用于网络重放，不是对话历史。
 */
export async function ensureMessageRequestIdIndex(): Promise<void> {
  if (!messageIndexGlobal.messageRequestIdIndexPromise) {
    messageIndexGlobal.messageRequestIdIndexPromise = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await Message.collection.createIndex(
            { tab_id: 1, request_id: 1 },
            REQUEST_ID_INDEX_OPTIONS
          );
          return;
        } catch (error) {
          if (isMongoErrorCode(error, [11000])) {
            const cleared = await clearDuplicateRequestIds();
            if (cleared === 0) throw error;
            console.warn(
              `已保留历史消息并移除 ${cleared} 个重复 requestId，以建立消息幂等唯一索引`
            );
            continue;
          }

          // 某些预发布环境可能已有同名的稀疏索引；Mongo 不能原地修改其
          // 选项，重建后普通消息的 null request_id 不会进入唯一约束。
          if (isMongoErrorCode(error, [85, 86])) {
            try {
              await Message.collection.dropIndex(REQUEST_ID_INDEX_NAME);
            } catch (dropError) {
              // 多进程同时升级时，另一进程可能已先完成删除。
              if (!isMongoErrorCode(dropError, [27])) throw dropError;
            }
            continue;
          }

          throw error;
        }
      }
      throw new Error("消息 requestId 唯一索引初始化未完成");
    })();
  }

  try {
    await messageIndexGlobal.messageRequestIdIndexPromise;
  } catch (error) {
    messageIndexGlobal.messageRequestIdIndexPromise = undefined;
    throw error;
  }
}

export default Message;
