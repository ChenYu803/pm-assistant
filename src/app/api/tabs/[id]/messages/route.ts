import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import {
  deleteMysqlMessage,
  getMysqlTabMessageMutationTestOptions,
  truncateMysqlMessages,
} from "@/lib/mysql-tab-message-mutations";
import {
  getMysqlMessagesRoute,
  stopMysqlMessageRoute,
} from "@/lib/mysql-messages-route";
import { parseMysqlTabMutationRequest } from "@/lib/mysql-tab-concurrency";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: tabId } = await params;
    if (!isMysqlId(tabId))
      return NextResponse.json({ error: "标签页参数无效" }, { status: 400 });
    return getMysqlMessagesRoute(tabId, userId);
  } catch (error) {
    console.error("GET /api/tabs/[id]/messages error:", error);
    return NextResponse.json(
      { error: mysqlUnavailableMessage() },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: tabId } = await params;
    if (!isMysqlId(tabId))
      return NextResponse.json({ error: "标签页参数无效" }, { status: 400 });
    return stopMysqlMessageRoute(
      tabId,
      userId,
      (await request.json().catch(() => null)) ?? {},
      request,
    );
  } catch (error) {
    console.error("PATCH /api/tabs/[id]/messages error:", error);
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
    if (!isMysqlId(tabId))
      return NextResponse.json({ error: "标签页参数无效" }, { status: 400 });

    const body = (await request.json().catch(() => null)) ?? {};
    const mutation = parseMysqlTabMutationRequest(body);
    const query = new URL(request.url).searchParams;
    const messageId =
      typeof body.messageId === "string"
        ? body.messageId
        : query.get("messageId");
    const fromMessageId =
      typeof body.fromMessageId === "string"
        ? body.fromMessageId
        : query.get("fromMessageId");
    if (!mutation)
      return NextResponse.json({ error: "并发请求参数无效" }, { status: 400 });
    if (messageId && fromMessageId) {
      return NextResponse.json(
        { error: "不能同时指定单条删除和截断删除" },
        { status: 400 },
      );
    }
    const targetMessageId = fromMessageId ?? messageId;
    if (!targetMessageId || !isMysqlId(targetMessageId)) {
      return NextResponse.json({ error: "消息不存在" }, { status: 404 });
    }

    const result = fromMessageId
      ? await truncateMysqlMessages({
          tabId,
          userId,
          fromMessageId: targetMessageId,
          mutation,
          options: getMysqlTabMessageMutationTestOptions(request),
        })
      : await deleteMysqlMessage({
          tabId,
          userId,
          messageId: targetMessageId,
          mutation,
          options: getMysqlTabMessageMutationTestOptions(request),
        });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("DELETE /api/tabs/[id]/messages error:", error);
    return NextResponse.json(
      { error: "删除消息失败，请手动重试" },
      { status: 500 },
    );
  }
}
