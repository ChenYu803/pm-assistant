import mongoose, { Document, Model } from "mongoose";

interface IPrototypeSnapshot {
  project_id: mongoose.Types.ObjectId;
  tab_id?: mongoose.Types.ObjectId;
  content: string;
  version: number;
  created_at: Date;
}

export interface IPrototypeSnapshotDocument
  extends IPrototypeSnapshot,
    Document {
  _id: mongoose.Types.ObjectId;
}

const PrototypeSnapshotSchema = new mongoose.Schema<IPrototypeSnapshotDocument>(
  {
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    tab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tab",
      required: false,
      index: true,
    },
    content: {
      type: String,
      required: true,
    },
    version: {
      type: Number,
      required: true,
    },
    created_at: {
      type: Date,
      default: () => new Date(),
    },
  },
  { collection: "prototype_snapshots" }
);

PrototypeSnapshotSchema.index({ project_id: 1, version: 1 }, { unique: true });

const PrototypeSnapshot: Model<IPrototypeSnapshotDocument> =
  mongoose.models.PrototypeSnapshot ??
  mongoose.model<IPrototypeSnapshotDocument>(
    "PrototypeSnapshot",
    PrototypeSnapshotSchema
  );

export default PrototypeSnapshot;
