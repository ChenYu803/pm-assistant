import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import { applyAutomaticWorkRecordName } from "@/lib/auto-name";
import { findOwnedWorkRecord, parseObjectId } from "@/lib/ownership";

/** 仅为 replay 专项提供可控的自动命名完成时点，生产环境始终不可访问。 */
export async function POST(request: Request) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.AUTO_NAME_TEST_HOOKS !== "1"
  ) {
    return NextResponse.json({ error: "资源不存在" }, { status: 404 });
  }

  const userId = await requireAuth();
  if (userId instanceof NextResponse) return userId;

  const body = await request.json().catch(() => null);
  const workRecordId = typeof body?.workRecordId === "string" ? body.workRecordId : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const delayMs =
    Number.isInteger(body?.delayMs) && body.delayMs >= 0 && body.delayMs <= 1_000
      ? body.delayMs
      : 0;
  const objectId = parseObjectId(workRecordId);
  if (!objectId || !name) {
    return NextResponse.json({ error: "自动命名参数无效" }, { status: 400 });
  }

  await dbConnect();
  const workRecord = await findOwnedWorkRecord(workRecordId, userId);
  if (!workRecord) {
    return NextResponse.json({ error: "工作记录不存在或无权操作" }, { status: 404 });
  }
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const updatedName = await applyAutomaticWorkRecordName(objectId, name);
  return NextResponse.json({ applied: Boolean(updatedName), name: updatedName });
}
