import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { changeMysqlFileRevision } from "@/lib/mysql-file-revisions";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: iterationId, fileId } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !isMysqlId(iterationId) || !isMysqlId(fileId) || !isMysqlId(body.projectId)) {
      return NextResponse.json({ error: "文件或产品迭代参数无效" }, { status: 400 });
    }
    if (body.action !== "edit" && body.action !== "restore") {
      return NextResponse.json({ error: "文件操作无效" }, { status: 400 });
    }
    const forceFailure = process.env.NODE_ENV !== "production" && process.env.AI_MODE === "replay"
      && request.headers.get("x-pm-assistant-test-file-revision-failure") === "1";
    const result = await changeMysqlFileRevision({
      projectId: body.projectId, iterationId, fileId, userId, action: body.action,
      content: body.content, forceFailure,
    });
    if (result.kind === "changed") return NextResponse.json(result);
    const responses = {
      "invalid-content": [result.error, 413],
      "not-found": ["文件不存在或无权访问", 404],
      "iteration-not-found": ["当前产品迭代不存在或不属于此项目", 409],
      "unsupported-file": ["此文件需按任务整套规则修改", 409],
      locked: ["冻结文档已正式锁定，不能修改", 409],
      "no-backup": ["没有可撤回的上一版", 409],
      unchanged: ["正文没有变化", 409],
    } as const;
    const [error, status] = responses[result.kind];
    return NextResponse.json({ error }, { status });
  } catch (error) {
    console.error("POST /api/iterations/[id]/files/[fileId] error:", error);
    return NextResponse.json({ error: "文件操作失败，原正文与修订未改变，请重试" }, { status: 500 });
  }
}
