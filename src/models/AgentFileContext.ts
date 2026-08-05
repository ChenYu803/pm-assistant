import mongoose, { Document, Model } from "mongoose";

/**
 * Tracks which files a tab has loaded into its agent context.
 * One record per (tab, file) pair.
 */
interface IAgentFileContext {
  tab_id: mongoose.Types.ObjectId;
  file_id: mongoose.Types.ObjectId;
  loaded_at: Date;
}

export interface IAgentFileContextDocument extends IAgentFileContext, Document {
  _id: mongoose.Types.ObjectId;
}

const AgentFileContextSchema = new mongoose.Schema<IAgentFileContextDocument>(
  {
    tab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tab",
      required: true,
    },
    file_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProjectFile",
      required: true,
    },
    loaded_at: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    collection: "agent_file_contexts",
  }
);

// Each (tab, file) pair must be unique
AgentFileContextSchema.index({ tab_id: 1, file_id: 1 }, { unique: true });

const AgentFileContext: Model<IAgentFileContextDocument> =
  mongoose.models.AgentFileContext ??
  mongoose.model<IAgentFileContextDocument>(
    "AgentFileContext",
    AgentFileContextSchema
  );

export default AgentFileContext;
