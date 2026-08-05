import mongoose from "mongoose";
import Project from "@/models/Project";
import WorkRecord from "@/models/WorkRecord";
import Tab from "@/models/Tab";
import ProjectFile from "@/models/ProjectFile";

/**
 * Validate a string is a valid MongoDB ObjectId.
 * Returns the parsed ObjectId or null.
 */
export function parseObjectId(id: string): mongoose.Types.ObjectId | null {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }
  return new mongoose.Types.ObjectId(id);
}

/**
 * Find a project by id and verify it belongs to the given user.
 * Returns the project document, or null if not found / not owned.
 */
export async function findOwnedProject(
  projectId: string,
  userId: string
) {
  const oid = parseObjectId(projectId);
  if (!oid) return null;

  return Project.findOne({
    _id: oid,
    user_id: userId,
  });
}

/**
 * Find a work record by id and verify its project belongs to the given user.
 * Returns the work record document, or null if not found / not owned.
 */
export async function findOwnedWorkRecord(
  workRecordId: string,
  userId: string
) {
  const oid = parseObjectId(workRecordId);
  if (!oid) return null;

  const workRecord = await WorkRecord.findById(oid);
  if (!workRecord) return null;

  const project = await findOwnedProject(
    workRecord.project_id.toString(),
    userId
  );
  if (!project) return null;

  return workRecord;
}

/**
 * Find a tab by id and verify its work record belongs to the given user.
 * Returns the tab document, or null if not found / not owned.
 */
export async function findOwnedTab(
  tabId: string,
  userId: string
) {
  const oid = parseObjectId(tabId);
  if (!oid) return null;

  const tab = await Tab.findById(oid);
  if (!tab) return null;

  const workRecord = await findOwnedWorkRecord(
    tab.work_record_id.toString(),
    userId
  );
  if (!workRecord) return null;

  return tab;
}

/**
 * Find a project file by id and verify its project belongs to the given user.
 * Returns the file document, or null if not found / not owned.
 */
export async function findOwnedProjectFile(
  fileId: string,
  userId: string
) {
  const oid = parseObjectId(fileId);
  if (!oid) return null;

  const file = await ProjectFile.findById(oid);
  if (!file) return null;

  const project = await findOwnedProject(
    file.project_id.toString(),
    userId
  );
  if (!project) return null;

  return file;
}
