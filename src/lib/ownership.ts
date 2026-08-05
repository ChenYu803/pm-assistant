import mongoose from "mongoose";
import Project from "@/models/Project";

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
