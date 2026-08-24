import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { autoNameMysqlWorkRecord } from "@/lib/auto-name";
import { findOwnedMysqlConversationTab } from "@/lib/mysql-conversation";
import { findOwnedMysqlWorkRecord } from "@/lib/mysql-account-workspace";

/** 仅 replay 专项用于控制自动命名完成时点。 */
export async function POST(request: Request) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.AUTO_NAME_TEST_HOOKS !== "1"
  )
    return NextResponse.json({ error: "资源不存在" }, { status: 404 });
  const userId = await requireAuth();
  if (userId instanceof NextResponse) return userId;
  const body = await request.json().catch(() => null);
  const workRecordId =
    typeof body?.workRecordId === "string" ? body.workRecordId : "";
  const tabId = typeof body?.tabId === "string" ? body.tabId : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!isMysqlId(workRecordId) || !isMysqlId(tabId) || !name)
    return NextResponse.json({ error: "自动命名参数无效" }, { status: 400 });
  const [workRecord, tab] = await Promise.all([
    findOwnedMysqlWorkRecord(workRecordId, userId),
    findOwnedMysqlConversationTab(tabId, userId),
  ]);
  if (!workRecord || !tab || tab.work_record_id !== workRecord.id)
    return NextResponse.json(
      { error: "工作记录不存在或无权操作" },
      { status: 404 },
    );
  const delayMs =
    Number.isInteger(body?.delayMs) &&
    body.delayMs >= 0 &&
    body.delayMs <= 1_000
      ? body.delayMs
      : 0;
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  const updated = await autoNameMysqlWorkRecord(tabId, workRecordId, {
    testName: name,
  });
  return NextResponse.json({ applied: Boolean(updated), name: updated });
}
