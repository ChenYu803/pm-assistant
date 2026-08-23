import mongoose, { Document, Model } from "mongoose";

interface DeletionWriteLease {
  token: string;
  expires_at: Date;
}

interface IWorkRecord {
  name: string;
  project_id: mongoose.Types.ObjectId;
  deletion_state: "active" | "deleting";
  deletion_write_leases: DeletionWriteLease[];
  deletion_started_at?: Date;
  created_at: Date;
}

export interface IWorkRecordDocument extends IWorkRecord, Document {
  _id: mongoose.Types.ObjectId;
}

const WorkRecordSchema = new mongoose.Schema<IWorkRecordDocument>(
  {
    name: {
      type: String,
      default: "未命名",
      trim: true,
    },
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    // 删除态只在服务端协调写入与补偿，不作为用户可见状态。
    deletion_state: {
      type: String,
      enum: ["active", "deleting"],
      default: "active",
    },
    deletion_write_leases: {
      type: [
        {
          _id: false,
          token: { type: String, required: true },
          expires_at: { type: Date, required: true },
        },
      ],
      default: [],
    },
    deletion_started_at: {
      type: Date,
    },
    created_at: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    collection: "work_records",
  }
);

const existingWorkRecord = mongoose.models.WorkRecord as
  | Model<IWorkRecordDocument>
  | undefined;

// next dev 复用已注册 model 时，补齐 #04 新增字段，避免删除闸门被旧 schema 忽略。
if (existingWorkRecord) {
  const addedPaths: Record<string, unknown> = {};
  if (!existingWorkRecord.schema.path("deletion_state")) {
    addedPaths.deletion_state = {
      type: String,
      enum: ["active", "deleting"],
      default: "active",
    };
  }
  if (!existingWorkRecord.schema.path("deletion_write_leases")) {
    addedPaths.deletion_write_leases = {
      type: [
        {
          _id: false,
          token: { type: String, required: true },
          expires_at: { type: Date, required: true },
        },
      ],
      default: [],
    };
  }
  if (!existingWorkRecord.schema.path("deletion_started_at")) {
    addedPaths.deletion_started_at = { type: Date };
  }
  if (Object.keys(addedPaths).length > 0) existingWorkRecord.schema.add(addedPaths);
}

const WorkRecord: Model<IWorkRecordDocument> =
  existingWorkRecord ??
  mongoose.model<IWorkRecordDocument>("WorkRecord", WorkRecordSchema);

export default WorkRecord;
