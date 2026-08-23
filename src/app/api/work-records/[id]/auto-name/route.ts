import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import { autoNameWorkRecord } from "@/lib/auto-name";
import { findOwnedTab, findOwnedWorkRecord, parseObjectId } from "@/lib/ownership";

/** 聊天完成后由页面单独调用；命名失败不会影响已完成的聊天。 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: workRecordId } = await params;
    const body = await request.json().catch(() => null);
    const tabId = typeof body?.tabId === "string" ? body.tabId : "";
    if (!parseObjectId(workRecordId) || !parseObjectId(tabId)) {
      return NextResponse.json({ error: "自动命名参数无效" }, { status: 400 });
    }

    await dbConnect();
    const [workRecord, tab] = await Promise.all([
      findOwnedWorkRecord(workRecordId, userId),
      findOwnedTab(tabId, userId),
    ]);
    if (!workRecord || !tab || tab.work_record_id.toString() !== workRecord._id.toString()) {
      return NextResponse.json(
        { error: "工作记录或标签页不存在或无权操作" },
        { status: 404 }
      );
    }

    const testHooksEnabled =
      process.env.NODE_ENV !== "production" &&
      process.env.AUTO_NAME_TEST_HOOKS === "1";
    const testName = testHooksEnabled
      ? request.headers.get("x-auto-name-test-name")?.trim().slice(0, 20)
      : undefined;
    const failureInjected =
      testHooksEnabled && request.headers.get("x-auto-name-test-failure") === "1";
    const name = await autoNameWorkRecord(tab._id, workRecord._id, {
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
