import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import { findOwnedProjectFile } from "@/lib/ownership";
import { createDeepSeekClient, DEEPSEEK_MODEL } from "@/lib/deepseek";

const POLISH_SYSTEM_PROMPT = `你是一个技术文档润色助手。请对以下 Markdown 内容进行润色：

1. 修正语法和拼写错误
2. 改善表达清晰度和专业性
3. 保持原有结构和信息不变
4. 不要添加新的内容或删除已有内容
5. 不要修改 Markdown 格式标记（标题、列表、代码块等）
6. 保留原有的变更日志头部（如果有的话）

请直接输出润色后的完整内容，不要添加任何解释或说明。`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { fileId } = await params;

    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json(
        { error: "内容不能为空" },
        { status: 400 }
      );
    }

    await dbConnect();

    // Verify file ownership
    const file = await findOwnedProjectFile(fileId, userId);
    if (!file) {
      return NextResponse.json(
        { error: "文件不存在或无权访问" },
        { status: 404 }
      );
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "AI 服务未配置，请联系管理员设置 DEEPSEEK_API_KEY" },
        { status: 500 }
      );
    }

    const openai = createDeepSeekClient();

    const response = await openai.chat.completions.create({
      model: DEEPSEEK_MODEL,
      max_tokens: 8192,
      messages: [
        { role: "system", content: POLISH_SYSTEM_PROMPT },
        { role: "user", content: `请润色以下 Markdown 内容：\n\n${content}` },
      ],
      stream: false,
    });

    const polished =
      response.choices[0]?.message?.content?.trim() ?? content;

    return NextResponse.json({ polished });
  } catch (error) {
    console.error("POST /api/projects/[id]/files/[fileId]/polish error:", error);
    return NextResponse.json(
      { error: "AI 润色失败" },
      { status: 500 }
    );
  }
}
