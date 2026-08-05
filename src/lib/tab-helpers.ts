import type { ITabDocument } from "@/models/Tab";
import type { TabData } from "@/lib/agent-constants";

/**
 * Serialize a Tab mongoose document to a plain TabData object.
 */
export function serializeTab(tab: ITabDocument): TabData & {
  work_record_id: string;
  created_at: Date;
} {
  return {
    id: tab._id.toString(),
    agent_type: tab.agent_type,
    display_name: tab.display_name,
    position: tab.position,
    scope_frozen: tab.scope_frozen ?? false,
    work_record_id: tab.work_record_id.toString(),
    created_at: tab.created_at,
  };
}
