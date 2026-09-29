import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { listMysqlIterationWrites } from "@/lib/mysql-file-history";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id } = await params;
    if (!isMysqlId(id)) return NextResponse.json({ error: "产品迭代参数无效" }, { status: 400 });
    const writes = await listMysqlIterationWrites(id, userId);
    return writes ? NextResponse.json(writes) : NextResponse.json({ error: "产品迭代不存在或无权访问" }, { status: 404 });
  } catch (error) {
    console.error("GET /api/iterations/[id]/writes error:", error);
    return NextResponse.json({ error: "本轮写入加载失败，请重试" }, { status: 500 });
  }
}
