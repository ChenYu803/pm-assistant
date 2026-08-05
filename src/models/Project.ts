import mongoose, { Document, Model } from "mongoose";

interface IProject {
  name: string;
  user_id: mongoose.Types.ObjectId;
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
    created_at: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    collection: "projects",
  }
);

const Project: Model<IProjectDocument> =
  mongoose.models.Project ??
  mongoose.model<IProjectDocument>("Project", ProjectSchema);

export default Project;
