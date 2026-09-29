import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { createMysqlTaskFolder, restoreMysqlTaskFolder } from "@/lib/mysql-task-folders";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id } = await params; const body = await request.json().catch(() => null);
    if (!isMysqlId(id) || !isMysqlId(body?.projectId)) return NextResponse.json({ error: "任务文件夹参数无效" }, { status: 400 });
    const result = await createMysqlTaskFolder(body.projectId, id, userId);
    if (result.kind === "created") return NextResponse.json(result, { status: 201 });
    if (result.kind === "exists") return NextResponse.json({ error: "本迭代已有任务文件夹", folderId: result.id }, { status: 409 });
    return NextResponse.json({ error: result.kind === "not-found" ? "项目不存在或无权访问" : "当前产品迭代不存在或不属于此项目" }, { status: result.kind === "not-found" ? 404 : 409 });
  } catch (error) { console.error("POST /api/iterations/[id]/task-folder error:", error); return NextResponse.json({ error: "创建任务文件夹失败" }, { status: 500 }); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id } = await params; const body = await request.json().catch(() => null);
    if (!isMysqlId(id) || !isMysqlId(body?.projectId) || !isMysqlId(body?.folderId) || body.action !== "restore") return NextResponse.json({ error: "任务文件夹参数无效" }, { status: 400 });
    const forceFailure = process.env.NODE_ENV !== "production" && process.env.AI_MODE === "replay" && request.headers.get("x-pm-assistant-test-task-failure") === "1";
    const result = await restoreMysqlTaskFolder({ projectId: body.projectId, iterationId: id, userId, folderId: body.folderId, forceFailure });
    if (result.kind === "changed") return NextResponse.json(result);
    const responses = {
      "not-found": ["项目不存在或无权访问", 404], "iteration-not-found": ["产品迭代不存在或不属于此项目", 409],
      "folder-not-found": ["任务文件夹不存在", 404], "read-only": ["只能撤回所属迭代的任务文件夹", 403],
      "no-backup": ["没有可撤回的任务集合", 409],
    } as const;
    const [error, status] = responses[result.kind];
    return NextResponse.json({ error }, { status });
  } catch (error) { console.error("PATCH /api/iterations/[id]/task-folder error:", error); return NextResponse.json({ error: "撤回任务集合失败，原集合未改变" }, { status: 500 }); }
}
