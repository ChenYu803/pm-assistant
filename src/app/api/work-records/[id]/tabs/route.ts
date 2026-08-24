import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { AGENT_TYPES, type AgentType } from "@/lib/agent-constants";
import { createMysqlTab, listMysqlTabs } from "@/lib/mysql-account-workspace";
import { mysqlUnavailableMessage } from "@/lib/mysql";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: workRecordId } = await params;

    const tabs = await listMysqlTabs(workRecordId, userId);
    if (!tabs) {
      return NextResponse.json(
        { error: "工作记录不存在或无权访问" },
        { status: 404 }
      );
    }

    return NextResponse.json(tabs);
  } catch (error) {
    console.error("GET /api/work-records/[id]/tabs error:", error);
    return NextResponse.json(
      { error: mysqlUnavailableMessage() },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: workRecordId } = await params;

    const body = await request.json();
    const { agent_type } = body;

    if (!agent_type || !AGENT_TYPES.includes(agent_type as AgentType)) {
      return NextResponse.json(
        { error: "无效的 Agent 类型" },
        { status: 400 }
      );
    }

    const tab = await createMysqlTab(workRecordId, userId, agent_type as AgentType);
    if (!tab) {
      return NextResponse.json(
        { error: "工作记录不存在或无权操作" },
        { status: 404 }
      );
    }

    // 项目文件和上下文将由 #04 迁移；空库首次创建 tab 时没有可自动加载文件。
    return NextResponse.json({ tab, context_files: [] }, { status: 201 });
  } catch (error) {
    console.error("POST /api/work-records/[id]/tabs error:", error);
    return NextResponse.json(
      { error: mysqlUnavailableMessage() },
      { status: 500 }
    );
  }
}
