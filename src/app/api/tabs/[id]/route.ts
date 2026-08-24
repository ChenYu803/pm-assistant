import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { renameMysqlTab } from "@/lib/mysql-account-workspace";
import {
  deleteMysqlTab,
  getMysqlTabMessageMutationTestOptions,
} from "@/lib/mysql-tab-message-mutations";
import {
  MYSQL_TAB_CONFLICT_MESSAGE,
  parseMysqlTabMutationRequest,
} from "@/lib/mysql-tab-concurrency";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: tabId } = await params;
    const body = await request.json();
    const mutation = parseMysqlTabMutationRequest(body);
    if (!isMysqlId(tabId))
      return NextResponse.json({ error: "标签页参数无效" }, { status: 400 });
    if (
      typeof body.display_name !== "string" ||
      !body.display_name.trim() ||
      !mutation
    )
      return NextResponse.json(
        { error: "标签页名称不能为空" },
        { status: 400 },
      );
    const result = await renameMysqlTab(
      tabId,
      userId,
      body.display_name.trim(),
      mutation.expectedVersion,
      mutation.requestId,
    );
    if (result.kind === "not-found")
      return NextResponse.json(
        { error: "标签页不存在或无权操作" },
        { status: 404 },
      );
    if (result.kind === "conflict")
      return NextResponse.json(
        {
          error: MYSQL_TAB_CONFLICT_MESSAGE,
          code: "TAB_VERSION_CONFLICT",
          currentVersion: result.currentVersion,
        },
        { status: 409 },
      );
    if (result.kind === "request-id-mismatch")
      return NextResponse.json(
        { error: "请求标识已用于其他操作" },
        { status: 409 },
      );
    return NextResponse.json(result.tab);
  } catch (error) {
    console.error("PATCH /api/tabs/[id] error:", error);
    return NextResponse.json(
      { error: mysqlUnavailableMessage() },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: tabId } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    const mutation = parseMysqlTabMutationRequest(body);
    if (!isMysqlId(tabId) || !mutation) {
      return NextResponse.json({ error: "并发请求参数无效" }, { status: 400 });
    }
    const result = await deleteMysqlTab({
      tabId,
      userId,
      mutation,
      options: getMysqlTabMessageMutationTestOptions(request),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("DELETE /api/tabs/[id] error:", error);
    return NextResponse.json(
      { error: "删除标签页失败，请手动重试" },
      { status: 500 },
    );
  }
}
