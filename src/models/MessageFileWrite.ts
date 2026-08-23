import mongoose, { Document, Model } from "mongoose";

export const MESSAGE_FILE_WRITE_OPERATIONS = ["create", "update"] as const;
export type MessageFileWriteOperation =
  (typeof MESSAGE_FILE_WRITE_OPERATIONS)[number];

export const MESSAGE_FILE_WRITE_STATUSES = ["written"] as const;
export type MessageFileWriteStatus =
  (typeof MESSAGE_FILE_WRITE_STATUSES)[number];

interface IMessageFileWrite {
  message_id: mongoose.Types.ObjectId;
  tab_id: mongoose.Types.ObjectId;
  project_id: mongoose.Types.ObjectId;
  project_file_id: mongoose.Types.ObjectId;
  filename: string;
  operation: MessageFileWriteOperation;
  file_version: number;
  message_status: "completed";
  write_status: MessageFileWriteStatus;
  written_at: Date;
}

export interface IMessageFileWriteDocument extends IMessageFileWrite, Document {
  _id: mongoose.Types.ObjectId;
}

const MessageFileWriteSchema = new mongoose.Schema<IMessageFileWriteDocument>(
  {
    message_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      required: true,
      index: true,
    },
    tab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tab",
      required: true,
      index: true,
    },
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    project_file_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProjectFile",
      required: true,
    },
    filename: {
      type: String,
      required: true,
    },
    operation: {
      type: String,
      enum: MESSAGE_FILE_WRITE_OPERATIONS,
      required: true,
    },
    file_version: {
      type: Number,
      required: true,
      min: 1,
    },
    message_status: {
      type: String,
      enum: ["completed"],
      required: true,
    },
    write_status: {
      type: String,
      enum: MESSAGE_FILE_WRITE_STATUSES,
      required: true,
    },
    written_at: {
      type: Date,
      default: () => new Date(),
    },
  },
  { collection: "message_file_writes" }
);

MessageFileWriteSchema.index(
  { message_id: 1, filename: 1, file_version: 1 },
  { unique: true }
);
MessageFileWriteSchema.index({ tab_id: 1, message_id: 1, written_at: 1 });

const MessageFileWrite: Model<IMessageFileWriteDocument> =
  mongoose.models.MessageFileWrite ??
  mongoose.model<IMessageFileWriteDocument>(
    "MessageFileWrite",
    MessageFileWriteSchema
  );

export default MessageFileWrite;
