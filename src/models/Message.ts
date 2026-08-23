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

interface IMessage {
  role: MessageRole;
  content: string;
  timestamp: Date;
  tab_id: mongoose.Types.ObjectId;
  status?: AssistantMessageStatus;
  error_message?: string;
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
      required: true,
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
  },
  {
    collection: "messages",
  }
);

// Compound index for efficient message retrieval ordered by time
MessageSchema.index({ tab_id: 1, timestamp: 1 });

const Message: Model<IMessageDocument> =
  mongoose.models.Message ??
  mongoose.model<IMessageDocument>("Message", MessageSchema);

export default Message;
