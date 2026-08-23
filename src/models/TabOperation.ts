import mongoose, { Document, Model } from "mongoose";

export const TAB_OPERATION_STATUSES = [
  "pending",
  "processing",
  "completed",
  "conflict",
  "failed",
] as const;
export type TabOperationStatus = (typeof TAB_OPERATION_STATUSES)[number];

export interface TabOperationResult {
  messageId?: string;
  tabVersion?: number;
  response?: Record<string, unknown>;
  httpStatus?: number;
  error?: string;
}

interface ITabOperation {
  tab_id: mongoose.Types.ObjectId;
  request_id: string;
  operation: string;
  expected_version: number;
  locked_version?: number;
  status: TabOperationStatus;
  result?: TabOperationResult;
  created_at: Date;
  updated_at: Date;
}

export interface ITabOperationDocument extends ITabOperation, Document {
  _id: mongoose.Types.ObjectId;
}

const TabOperationSchema = new mongoose.Schema<ITabOperationDocument>(
  {
    tab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tab",
      required: true,
    },
    request_id: {
      type: String,
      required: true,
      trim: true,
    },
    operation: {
      type: String,
      required: true,
      trim: true,
    },
    expected_version: {
      type: Number,
      required: true,
      min: 0,
    },
    locked_version: {
      type: Number,
      min: 0,
    },
    status: {
      type: String,
      enum: TAB_OPERATION_STATUSES,
      required: true,
      default: "pending",
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
    },
    created_at: {
      type: Date,
      default: () => new Date(),
    },
    updated_at: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    collection: "tab_operations",
  }
);

TabOperationSchema.index({ tab_id: 1, request_id: 1 }, { unique: true });

const TabOperation: Model<ITabOperationDocument> =
  mongoose.models.TabOperation ??
  mongoose.model<ITabOperationDocument>("TabOperation", TabOperationSchema);

export default TabOperation;
