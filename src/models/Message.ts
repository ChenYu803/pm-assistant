import mongoose, { Document, Model } from "mongoose";

export const MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

interface IMessage {
  role: MessageRole;
  content: string;
  timestamp: Date;
  tab_id: mongoose.Types.ObjectId;
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
