import { AccountAccessError } from "@/lib/account-controls";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { isAIConfigured } from "@/lib/ai";
import { isMysqlId } from "@/lib/identifiers";
import { findOwnedMysqlProjectFile } from "@/lib/mysql-project-artifacts";
import { AIQuotaError } from "@/lib/mysql-ai-budget";
import { CreditError } from "@/lib/credit-values";
import { createIterationGenerationStream } from "@/lib/iteration-generation-stream";
import { stopPolishRequest } from "@/lib/model-request-control";
import { generatePolish, readPolishOperation } from "@/lib/polish-generation";

type Context = { params: Promise<{ id: string; fileId: string }> };
const noStore = { "Cache-Control": "private, no-store" };
const validRequestId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{16,120}$/.test(value);

function failure(error: unknown) {
  const status = error instanceof AccountAccessError ? 403 : error instanceof AIQuotaError ? 429 : error instanceof CreditError ? error.status : error instanceof SyntaxError ? 400 : 500;
  return { status, body: { error: status < 500 ? (error as Error).message : "AI 润色失败，请保留原请求重试。" } };
}
async function authorize(context: Context) {
  const userId = await requireAuth();
  if (userId instanceof NextResponse) return userId;
  const { id: projectId, fileId } = await context.params;
  if (!isMysqlId(projectId) || !isMysqlId(fileId)) return NextResponse.json({ error: "项目或文件参数无效" }, { status: 400 });
  const file = await findOwnedMysqlProjectFile(projectId,fileId,userId);
  if (!file) return NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
  return { userId,projectId,fileId,file };
}

export async function GET(request: Request, context: Context) {
  try {
    const target = await authorize(context);
    if (target instanceof NextResponse) return target;
    const requestId = new URL(request.url).searchParams.get("requestId") ?? undefined;
    if (requestId !== undefined && !validRequestId(requestId)) throw new CreditError("润色操作标识无效。",400);
    const operation = await readPolishOperation(target,requestId);
    // GET 总能返回费用，包括失败终态；查询不重发模型、不变动资金。
    return NextResponse.json(operation?.body ?? {}, { headers: noStore });
  } catch (error) {
    const result = failure(error);
    return NextResponse.json(result.body,{status:result.status,headers:noStore});
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const target = await authorize(context);
    if (target instanceof NextResponse) return target;
    const { requestId } = (await request.json()) ?? {};
    if (!validRequestId(requestId)) throw new CreditError("润色操作标识无效。",400);
    const existing = await readPolishOperation(target,requestId);
    if (!existing) throw new CreditError("润色请求尚未确认，请稍后重试停止。",409);
    await stopPolishRequest(target.userId,requestId,target.fileId);
    const operation = await readPolishOperation(target,requestId);
    return NextResponse.json(operation!.body,{headers:noStore});
  } catch (error) {
    const result = failure(error);
    return NextResponse.json(result.body,{status:result.status,headers:noStore});
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const target = await authorize(context);
    if (target instanceof NextResponse) return target;
    const { content,requestId } = (await request.json()) ?? {};
    if (typeof content !== "string" || !content.trim()) throw new CreditError("内容不能为空。",400);
    if (!validRequestId(requestId)) throw new CreditError("缺少有效润色操作标识，请刷新后重试。",400);
    if (!isAIConfigured()) throw new CreditError("AI 服务未配置，请联系管理员。",503);
    const generate = async (signal?: AbortSignal) => {
      try { return await generatePolish({ ...target,content,requestId,signal }); }
      catch (error) { return failure(error); }
    };
    if (request.headers.get("accept")?.includes("text/event-stream")) {
      return createIterationGenerationStream((_onContent,signal) => generate(signal),15_000,request.signal);
    }
    const result = await generate(request.signal);
    return NextResponse.json(result.body,{status:result.status,headers:noStore});
  } catch (error) {
    const result = failure(error);
    return NextResponse.json(result.body,{status:result.status,headers:noStore});
  }
}
