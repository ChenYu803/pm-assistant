import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Tab from "@/models/Tab";
import ProjectFile from "@/models/ProjectFile";
import AgentFileContext from "@/models/AgentFileContext";
import { AGENT_TYPES, AGENT_TYPE_LABELS, type AgentType } from "@/lib/agent-constants";
import { findOwnedWorkRecord } from "@/lib/ownership";
import { serializeTab } from "@/lib/tab-helpers";
import type { ITabDocument } from "@/models/Tab";

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

    return NextResponse.json(
      tabs.map((t) => serializeTab(t as unknown as ITabDocument))
    );
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

    // Auto-load 需求分析.md into context for MVP-PRD Agent tabs
    let contextFiles: { id: string; filename: string }[] = [];
    if (agent_type === "mvp_prd") {
      try {
        const reqFile = await ProjectFile.findOne({
          project_id: workRecord.project_id,
          filename: "需求分析.md",
        });
        if (reqFile) {
          await AgentFileContext.create({
            tab_id: tab._id,
            file_id: reqFile._id,
          });
          contextFiles = [
            { id: reqFile._id.toString(), filename: reqFile.filename },
          ];
        }
      } catch (err) {
        // Duplicate key (11000) is fine — context already exists
        if ((err as { code?: number }).code !== 11000) {
          console.error("Auto-load context failed:", err);
        }
      }
    }

    return NextResponse.json(
      {
        tab: serializeTab(tab),
        context_files: contextFiles,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/work-records/[id]/tabs error:", error);
    return NextResponse.json(
      { error: "创建标签页失败" },
      { status: 500 }
    );
  }
}
