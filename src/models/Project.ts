import mongoose, { Document, Model } from "mongoose";

interface DeletionWriteLease {
  token: string;
  expires_at: Date;
}

interface IProject {
  name: string;
  user_id: mongoose.Types.ObjectId;
  deletion_state: "active" | "deleting";
  deletion_write_leases: DeletionWriteLease[];
  deletion_started_at?: Date;
  created_at: Date;
}

export interface IProjectDocument extends IProject, Document {
  _id: mongoose.Types.ObjectId;
}

const ProjectSchema = new mongoose.Schema<IProjectDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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
    collection: "projects",
  }
);

const existingProject = mongoose.models.Project as Model<IProjectDocument> | undefined;

// next dev 复用已注册 model 时，补齐 #04 新增字段，避免删除闸门被旧 schema 忽略。
if (existingProject) {
  const addedPaths: Record<string, unknown> = {};
  if (!existingProject.schema.path("deletion_state")) {
    addedPaths.deletion_state = {
      type: String,
      enum: ["active", "deleting"],
      default: "active",
    };
  }
  if (!existingProject.schema.path("deletion_write_leases")) {
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
  if (!existingProject.schema.path("deletion_started_at")) {
    addedPaths.deletion_started_at = { type: Date };
  }
  if (Object.keys(addedPaths).length > 0) existingProject.schema.add(addedPaths);
}

const Project: Model<IProjectDocument> =
  existingProject ?? mongoose.model<IProjectDocument>("Project", ProjectSchema);

export default Project;
