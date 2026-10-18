import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { createAICompletion, isAIConfigured } from "@/lib/ai";
import { isMysqlId } from "@/lib/identifiers";
import { findOwnedMysqlProjectFile } from "@/lib/mysql-project-artifacts";
import { AIQuotaError } from "@/lib/mysql-ai-budget";
import { createIterationGenerationStream } from "@/lib/iteration-generation-stream";

const POLISH_SYSTEM_PROMPT = `你是一个技术文档润色助手。请对以下 Markdown 内容进行润色：

1. 修正语法和拼写错误
2. 改善表达清晰度和专业性
3. 保持原有结构和信息不变
4. 不要添加新的内容或删除已有内容
5. 不要修改 Markdown 格式标记（标题、列表、代码块等）
6. 保留原有的变更日志头部（如果有的话）

请直接输出润色后的完整内容，不要添加任何解释或说明。`;
export async function POST(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id: projectId, fileId } = await params; const { content } = await request.json();
    if (!isMysqlId(projectId)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
    if (!isMysqlId(fileId)) return NextResponse.json({ error: "fileId 参数无效" }, { status: 400 });
    if (typeof content !== "string" || !content.trim()) return NextResponse.json({ error: "内容不能为空" }, { status: 400 });
    if (!await findOwnedMysqlProjectFile(projectId, fileId, userId)) return NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
    if (!isAIConfigured()) return NextResponse.json({ error: "AI 服务未配置，请联系管理员设置 AI_API_KEY" }, { status: 500 });
    const generate = async (signal?: AbortSignal) => {
      try {
        const polished = await createAICompletion({ userId, maxTokens: 32768, messages: [{ role: "system", content: POLISH_SYSTEM_PROMPT }, { role: "user", content: `请润色以下 Markdown 内容：\n\n${content}` }], timeoutMs: 600_000, signal });
        return { status: 200, body: { polished } };
      } catch (error) {
        return { status: error instanceof AIQuotaError ? 429 : 500, body: { error: error instanceof AIQuotaError ? error.message : "AI 润色失败" } };
      }
    };
    // 润色预览仍只展示完整结果；等待时心跳避免入口把长响应视作无响应。
    if (request.headers.get("accept")?.includes("text/event-stream")) {
      return createIterationGenerationStream((_onContent, signal) => generate(signal), 15_000, request.signal);
    }
    const result = await generate(request.signal);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { if (error instanceof AIQuotaError) return NextResponse.json({ error: error.message }, { status: 429 }); console.error("POST /api/projects/[id]/files/[fileId]/polish error:", error); return NextResponse.json({ error: "AI 润色失败" }, { status: 500 }); }
}
