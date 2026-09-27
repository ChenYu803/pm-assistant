import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { decideAnalysisCandidate } from "@/lib/mysql-iteration-candidates";

type Params = Promise<{ id: string; sessionId: string; candidateId: string }>;

export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id, sessionId, candidateId } = await params;
    if (![id, sessionId, candidateId].every(isMysqlId)) return NextResponse.json({ error: "候选参数无效" }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    if (body.action !== "write" && body.action !== "discard") return NextResponse.json({ error: "候选操作无效" }, { status: 400 });
    if (body.action === "write" && (typeof body.filename !== "string" || !["create", "overwrite"].includes(body.expectedOperation))) {
      return NextResponse.json({ error: "请先确认目标路径和创建或覆盖操作" }, { status: 400 });
    }
    const result = await decideAnalysisCandidate({
      iterationId: id, sessionId, candidateId, userId, action: body.action,
      filename: body.filename, expectedOperation: body.expectedOperation,
      forceFailure: process.env.NODE_ENV !== "production" && request.headers.get("x-pm-verify-candidate-write-fail") === "1",
    });
    if (result.kind === "not-found") return NextResponse.json({ error: "候选不存在或无权访问" }, { status: 404 });
    if (result.kind === "invalid-filename") return NextResponse.json({ error: "文件名应为“需求分析-描述.md”，且不能包含路径或工作文档名称" }, { status: 400 });
    if (result.kind === "too-large") return NextResponse.json({ error: "文件正文超过 3 MiB 上限" }, { status: 413 });
    if (result.kind === "operation-changed") return NextResponse.json({ error: `目标路径状态已变化，当前操作为${result.operation === "create" ? "创建" : "覆盖"}，请核对后重试`, operation: result.operation }, { status: 409 });
    if (result.kind === "locked") return NextResponse.json({ error: "目标文件已锁定，不能覆盖" }, { status: 409 });
    if (result.kind === "decided") return NextResponse.json({ error: "这份候选已处理，不能重复写入" }, { status: 409 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("POST iteration file candidate error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
