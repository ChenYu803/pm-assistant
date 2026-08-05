import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Tab from "@/models/Tab";
import { AGENT_TYPES, AGENT_TYPE_LABELS, type AgentType } from "@/lib/agent-constants";
import { findOwnedWorkRecord } from "@/lib/ownership";
import { serializeTab } from "@/lib/tab-helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: workRecordId } = await params;

    await dbConnect();

    const workRecord = await findOwnedWorkRecord(workRecordId, userId);
    if (!workRecord) {
      return NextResponse.json(
        { error: "工作记录不存在或无权访问" },
        { status: 404 }
      );
    }

    const tabs = await Tab.find({ work_record_id: workRecord._id })
      .sort({ position: 1, created_at: 1 })
      .lean();

    return NextResponse.json(tabs.map((t) => serializeTab(t as any)));
  } catch (error) {
    console.error("GET /api/work-records/[id]/tabs error:", error);
    return NextResponse.json(
      { error: "获取标签页列表失败" },
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

    await dbConnect();

    const workRecord = await findOwnedWorkRecord(workRecordId, userId);
    if (!workRecord) {
      return NextResponse.json(
        { error: "工作记录不存在或无权操作" },
        { status: 404 }
      );
    }

    // Auto-generate display name: "需求分析 #N" or "MVP-PRD #N"
    const existingCount = await Tab.countDocuments({
      work_record_id: workRecord._id,
      agent_type,
    });
    const label = AGENT_TYPE_LABELS[agent_type as AgentType];
    const displayName = `${label} #${existingCount + 1}`;

    // Determine position: after the last tab
    const lastTab = await Tab.findOne({ work_record_id: workRecord._id })
      .sort({ position: -1 })
      .lean();
    const position = lastTab ? lastTab.position + 1 : 0;

    const tab = await Tab.create({
      agent_type,
      display_name: displayName,
      position,
      work_record_id: workRecord._id,
    });

    return NextResponse.json(serializeTab(tab), { status: 201 });
  } catch (error) {
    console.error("POST /api/work-records/[id]/tabs error:", error);
    return NextResponse.json(
      { error: "创建标签页失败" },
      { status: 500 }
    );
  }
}
