import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { decideTaskSetCandidate, previewTaskSetCandidate } from "@/lib/mysql-task-set-candidates";

type Context = { params: Promise<{ id: string; sessionId: string; candidateId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id, sessionId, candidateId } = await params;
    if (![id, sessionId, candidateId].every(isMysqlId)) return NextResponse.json({ error: "候选参数无效" }, { status: 400 });
    const result = await previewTaskSetCandidate({ iterationId: id, sessionId, candidateId, userId });
    if (result.kind === "not-found") return NextResponse.json({ error: "候选不存在或无权访问" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("GET task set candidate error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id, sessionId, candidateId } = await params;
    if (![id, sessionId, candidateId].every(isMysqlId)) return NextResponse.json({ error: "候选参数无效" }, { status: 400 });
    const body = await request.json().catch(() => null);
    if (!body || !["write", "discard"].includes(body.action) || body.action === "write" && !/^[a-f0-9]{64}$/.test(body.expectedFingerprint)) {
      return NextResponse.json({ error: "请先审阅当前整套差异" }, { status: 400 });
    }
    const result = await decideTaskSetCandidate({ iterationId: id, sessionId, candidateId, userId,
      action: body.action, expectedFingerprint: body.expectedFingerprint,
      forceFailure: process.env.NODE_ENV !== "production" && process.env.AI_MODE === "replay" && request.headers.get("x-pm-assistant-test-task-failure") === "1" });
    if (result.kind === "not-found") return NextResponse.json({ error: "候选不存在或无权访问" }, { status: 404 });
    if (result.kind === "decided") return NextResponse.json({ error: "这套候选已处理" }, { status: 409 });
    if (result.kind === "stale") return NextResponse.json({ error: "任务文件夹已变化，请重新审阅整套差异" }, { status: 409 });
    if (result.kind === "too-large") return NextResponse.json({ error: "某个 issue 超过 3 MiB 上限" }, { status: 413 });
    if (result.kind === "number-exhausted") return NextResponse.json({ error: "任务序号已达到上限" }, { status: 409 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("POST task set candidate error:", error);
    return NextResponse.json({ error: "整套任务提交失败，旧集合未改变，候选可重试" }, { status: 500 });
  }
}
