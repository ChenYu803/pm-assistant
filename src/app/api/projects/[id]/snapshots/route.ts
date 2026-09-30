import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { MAX_FILE_BYTES } from "@/lib/file-helpers";
import { createMysqlSnapshot, listMysqlSnapshots, MysqlIterationRequiredError } from "@/lib/mysql-project-artifacts";
import { listIterationPrototypeSnapshots } from "@/lib/iteration-prototype-snapshots";
import { findOwnedWorkbenchIteration } from "@/lib/mysql-iteration-workbench";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: projectId } = await params;
    if (!isMysqlId(projectId)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
    const iterationId = new URL(request.url).searchParams.get("iterationId");
    if (iterationId) {
      if (!isMysqlId(iterationId)) return NextResponse.json({ error: "迭代参数无效" }, { status: 400 });
      const iteration = await findOwnedWorkbenchIteration(iterationId, userId);
      if (!iteration || iteration.project_id !== projectId) return NextResponse.json({ error: "产品迭代不存在或无权访问" }, { status: 404 });
      const snapshots = await listIterationPrototypeSnapshots(projectId, iterationId);
      return NextResponse.json(snapshots.map(({ id, version, iteration_id, session_id, message_id, created_at }) => ({
        id, version: Number(version), iterationId: iteration_id, sessionId: session_id, messageId: message_id, createdAt: created_at,
      })));
    }
    const snapshots = await listMysqlSnapshots(projectId, userId);
    if (!snapshots) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
    return NextResponse.json(
      snapshots.map(({ id, tab_id, version, created_at }) => ({
        id,
        version: Number(version),
        tab_id,
        created_at,
        createdAt: created_at,
      }))
    );
  } catch (error) {
    console.error("GET /api/projects/[id]/snapshots error:", error);
    return NextResponse.json({ error: "获取 HTML 快照列表失败" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: projectId } = await params;
    const { content, tab_id: tabId } = await request.json();
    if (!isMysqlId(projectId)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
    if (typeof content !== "string" || !content.trim()) return NextResponse.json({ error: "HTML 快照内容不能为空" }, { status: 400 });
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) return NextResponse.json({ error: "HTML 快照超过 3 MiB 上限" }, { status: 413 });
    if (tabId !== undefined && (typeof tabId !== "string" || !isMysqlId(tabId))) return NextResponse.json({ error: "tabId 参数无效" }, { status: 400 });
    const result = await createMysqlSnapshot({ projectId, userId, content, ...(tabId ? { tabId } : {}) });
    if (result.kind === "project-not-found") return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
    if (result.kind === "tab-not-found") return NextResponse.json({ error: "标签页不存在或不属于当前项目" }, { status: 404 });
    const snapshot = result.snapshot;
    return NextResponse.json({ id: snapshot.id, version: Number(snapshot.version), tab_id: snapshot.tab_id, content: snapshot.content, created_at: snapshot.created_at }, { status: 201 });
  } catch (error) {
    if (error instanceof MysqlIterationRequiredError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("POST /api/projects/[id]/snapshots error:", error);
    return NextResponse.json({ error: "保存 HTML 快照失败" }, { status: 500 });
  }
}
