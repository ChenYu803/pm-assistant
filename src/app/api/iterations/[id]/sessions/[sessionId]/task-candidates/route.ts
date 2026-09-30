import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { createManualTaskSetCandidate, getManualTaskSetDraft } from "@/lib/mysql-task-set-candidates";

type Context = { params: Promise<{ id: string; sessionId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id, sessionId } = await params;
    if (!isMysqlId(id) || !isMysqlId(sessionId)) return NextResponse.json({ error: "会话参数无效" }, { status: 400 });
    const draft = await getManualTaskSetDraft({ iterationId: id, sessionId, userId });
    if (draft === null) return NextResponse.json({ error: "任务会话不存在或无权访问" }, { status: 404 });
    return NextResponse.json(draft);
  } catch (error) { console.error("GET manual task set draft error:", error); return NextResponse.json({ error: "加载当前任务集合失败" }, { status: 500 }); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id, sessionId } = await params;
    if (!isMysqlId(id) || !isMysqlId(sessionId)) return NextResponse.json({ error: "会话参数无效" }, { status: 400 });
    const body = await request.json().catch(() => null);
    if (typeof body?.content !== "string") return NextResponse.json({ error: "请填写完整任务集合" }, { status: 400 });
    const result = await createManualTaskSetCandidate({ iterationId: id, sessionId, userId, answer: body.content });
    if (result.kind === "invalid") return NextResponse.json({ error: "任务内容不完整：每个 issue 需要明确的 What to build、Blocked by 和非空验收标准；依赖应引用本候选内的编号" }, { status: 400 });
    if (result.kind === "not-found") return NextResponse.json({ error: "任务会话不存在或无权访问" }, { status: 404 });
    if (result.kind === "generating") return NextResponse.json({ error: "当前会话仍在生成，请结束后再提出候选" }, { status: 409 });
    if (result.kind === "stage-completed") return NextResponse.json({ error: "本阶段已完成，请先重新打开阶段" }, { status: 409 });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { console.error("POST manual task set candidate error:", error); return NextResponse.json({ error: "创建任务候选失败，请重试" }, { status: 500 }); }
}
