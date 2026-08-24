import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { postMysqlChat } from "@/lib/mysql-chat";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: tabId } = await params;
    if (!isMysqlId(tabId))
      return NextResponse.json({ error: "标签页参数无效" }, { status: 400 });
    return postMysqlChat({
      request,
      userId,
      tabId,
      body: await request.json(),
    });
  } catch (error) {
    console.error("POST /api/tabs/[id]/chat error:", error);
    return NextResponse.json(
      { error: mysqlUnavailableMessage() },
      { status: 500 },
    );
  }
}
