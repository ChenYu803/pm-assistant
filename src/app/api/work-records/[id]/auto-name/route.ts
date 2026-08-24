import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { autoNameMysqlWorkRecord } from "@/lib/auto-name";
import { isMysqlId } from "@/lib/identifiers";
import { findOwnedMysqlConversationTab } from "@/lib/mysql-conversation";
import { findOwnedMysqlWorkRecord } from "@/lib/mysql-account-workspace";

/** 聊天完成后由页面单独调用；命名失败不会影响已完成的聊天。 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: workRecordId } = await params;
    const body = await request.json().catch(() => null);
    const tabId = typeof body?.tabId === "string" ? body.tabId : "";
    const testHooksEnabled =
      process.env.NODE_ENV !== "production" &&
      process.env.AUTO_NAME_TEST_HOOKS === "1";
    const testName = testHooksEnabled
      ? request.headers.get("x-auto-name-test-name")?.trim().slice(0, 20)
      : undefined;
    const failureInjected =
      testHooksEnabled &&
      request.headers.get("x-auto-name-test-failure") === "1";
    if (!isMysqlId(workRecordId) || !isMysqlId(tabId)) {
      return NextResponse.json({ error: "自动命名参数无效" }, { status: 400 });
    }
    const [workRecord, tab] = await Promise.all([
      findOwnedMysqlWorkRecord(workRecordId, userId),
      findOwnedMysqlConversationTab(tabId, userId),
    ]);
    if (!workRecord || !tab || tab.work_record_id !== workRecord.id) {
      return NextResponse.json(
        { error: "工作记录或标签页不存在或无权操作" },
        { status: 404 },
      );
    }

    const name = await autoNameMysqlWorkRecord(tab.id, workRecord.id, {
      testName,
      forceFailureForTest: failureInjected,
    });

    return NextResponse.json({
      name,
      ...(testHooksEnabled ? { testFailureInjected: failureInjected } : {}),
    });
  } catch (error) {
    console.error("POST /api/work-records/[id]/auto-name error:", error);
    return NextResponse.json({ error: "自动命名失败" }, { status: 500 });
  }
}
