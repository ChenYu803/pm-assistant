import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { postMysqlFreezeRoute } from "@/lib/mysql-freeze-route";

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
    return postMysqlFreezeRoute(
      tabId,
      userId,
      (await request.json().catch(() => null)) ?? {},
    );
  } catch (error) {
    console.error("POST /api/tabs/[id]/freeze error:", error);
    return NextResponse.json(
      { error: mysqlUnavailableMessage() },
      { status: 500 },
    );
  }
}
