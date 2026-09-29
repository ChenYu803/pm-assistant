import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { changeMysqlFileRevision } from "@/lib/mysql-file-revisions";
import { changeMysqlFileIdentity } from "@/lib/mysql-file-history";

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

async function handleIdentityChange(request: Request, params: Promise<{ id: string; fileId: string }>, action: "rename" | "delete") {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: iterationId, fileId } = await params;
    const body = await request.json().catch(() => null);
    if (!isMysqlId(iterationId) || !isMysqlId(fileId) || !isMysqlId(body?.projectId)
      || (action === "rename" && body?.action !== "rename")) {
      return NextResponse.json({ error: "文件或产品迭代参数无效" }, { status: 400 });
    }
    const forceFailure = process.env.NODE_ENV !== "production" && process.env.AI_MODE === "replay"
      && request.headers.get("x-pm-assistant-test-file-identity-failure") === "1";
    const result = await changeMysqlFileIdentity({ projectId: body.projectId, iterationId, fileId, userId,
      action, filename: action === "rename" ? body.filename : undefined, forceFailure });
    if (result.kind === "changed") return NextResponse.json(result);
    const responses = {
      "not-found": ["文件不存在或无权访问", 404],
      "iteration-not-found": ["当前产品迭代不存在或不属于此项目", 409],
      "unsupported-file": ["此文件需按任务整套规则修改", 409],
      locked: [`冻结文档已正式锁定，不能${action === "rename" ? "改名" : "删除"}`, 409],
      "invalid-filename": ["文件名须保留当前树枝前缀、使用 Markdown 后缀且不能包含路径", 400],
      duplicate: ["项目中已有同名文件，请换一个名称", 409],
      unchanged: ["文件名没有变化", 409],
    } as const;
    const [error, status] = responses[result.kind];
    return NextResponse.json({ error }, { status });
  } catch (error) {
    console.error(`${action === "rename" ? "PATCH" : "DELETE"} /api/iterations/[id]/files/[fileId] error:`, error);
    return NextResponse.json({ error: action === "rename" ? "文件改名失败，原路径未改变，请重试" : "文件删除失败，正文和历史未改变，请重试" }, { status: 500 });
  }
}

export function PATCH(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  return handleIdentityChange(request, params, "rename");
}

export function DELETE(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  return handleIdentityChange(request, params, "delete");
}
