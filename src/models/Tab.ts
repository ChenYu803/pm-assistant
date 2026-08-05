import mongoose, { Document, Model } from "mongoose";
import { AGENT_TYPES, type AgentType } from "@/lib/agent-constants";

interface ITab {
  agent_type: AgentType;
  display_name: string;
  position: number;
  work_record_id: mongoose.Types.ObjectId;
  scope_frozen: boolean;
  created_at: Date;
}

export interface ITabDocument extends ITab, Document {
  _id: mongoose.Types.ObjectId;
}

const TabSchema = new mongoose.Schema<ITabDocument>(
  {
    agent_type: {
      type: String,
      required: true,
      enum: AGENT_TYPES,
    },
    display_name: {
      type: String,
      required: true,
      trim: true,
    },
    position: {
      type: Number,
      required: true,
      default: 0,
    },
    work_record_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkRecord",
      required: true,
      index: true,
    },
    scope_frozen: {
      type: Boolean,
      default: false,
    },
    created_at: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    collection: "tabs",
  }
);

const Tab: Model<ITabDocument> =
  mongoose.models.Tab ??
  mongoose.model<ITabDocument>("Tab", TabSchema);

export default Tab;
