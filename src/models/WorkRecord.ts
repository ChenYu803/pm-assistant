import mongoose, { Document, Model } from "mongoose";

interface IWorkRecord {
  name: string;
  project_id: mongoose.Types.ObjectId;
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
    created_at: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    collection: "work_records",
  }
);

const WorkRecord: Model<IWorkRecordDocument> =
  mongoose.models.WorkRecord ??
  mongoose.model<IWorkRecordDocument>("WorkRecord", WorkRecordSchema);

export default WorkRecord;
