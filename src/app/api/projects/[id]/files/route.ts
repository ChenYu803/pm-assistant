import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import ProjectFile, {
  formatChangelogHeader,
  parseChangelog,
  countRequirements,
  type ChangelogEntry,
  type IProjectFileDocument,
} from "@/models/ProjectFile";
import { findOwnedProject } from "@/lib/ownership";
import { serializeProjectFile, stripChangelogHeader } from "@/lib/file-helpers";

/**
 * Renumber every top-level "## " section in a 需求分析.md body sequentially
 * (numbered or not), so appended requirements compose into a single coherent
 * list regardless of what number the agent happened to output.
 */
function normalizeRequirementSections(body: string): string {
  let n = 0;
  return body.replace(/^##\s+(?:\d+[\.、]\s*)?(.+)$/gm, (_m, title: string) => {
    n += 1;
    return `## ${n}. ${title.trim()}`;
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: projectId } = await params;

    await dbConnect();

    const project = await findOwnedProject(projectId, userId);
    if (!project) {
      return NextResponse.json(
        { error: "项目不存在或无权访问" },
        { status: 404 }
      );
    }

    const files = await ProjectFile.find({ project_id: project._id })
      .sort({ updated_at: -1 })
      .lean();

    return NextResponse.json(
      files.map((f) => {
        const serialized = serializeProjectFile(f as unknown as IProjectFileDocument);
        // Omit content from list endpoint — call GET /files/:id for full content
        const { content: _, ...rest } = serialized;
        return rest;
      })
    );
  } catch (error) {
    console.error("GET /api/projects/[id]/files error:", error);
    return NextResponse.json(
      { error: "获取文件列表失败" },
      { status: 500 }
    );
  }
}

/** Agent writes/updates a file. Prepends changelog header automatically. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { id: projectId } = await params;

    const body = await request.json();
    const {
      filename,
      content,
      agent_type,
      iteration,
    } = body as {
      filename: string;
      content: string;
      agent_type: string;
      iteration?: number;
    };

    if (!filename || typeof filename !== "string" || !filename.trim()) {
      return NextResponse.json(
        { error: "文件名不能为空" },
        { status: 400 }
      );
    }

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "文件内容不能为空" },
        { status: 400 }
      );
    }

    await dbConnect();

    const project = await findOwnedProject(projectId, userId);
    if (!project) {
      return NextResponse.json(
        { error: "项目不存在或无权访问" },
        { status: 404 }
      );
    }

    const trimmedFilename = filename.trim();

    // Find existing file or create new
    let file = await ProjectFile.findOne({
      project_id: project._id,
      filename: trimmedFilename,
    });

    // Parse existing changelog (or start fresh)
    let existingIteration = 0;
    if (file) {
      const parsed = parseChangelog(file.content);
      existingIteration = parsed ? parsed.entry.iteration : 0;
    }

    // 需求分析 Agent appends each requirement to the shared whiteboard file
    // (spec US20: 每条需求独立确认后追加入需求分析.md). PRD Agent replaces.
    const isRequirementAppend = agent_type === "requirement_analyst";

    // Build new changelog
    const nextIteration =
      iteration ?? (isRequirementAppend ? existingIteration || 1 : existingIteration + 1);

    let bodyContent = content; // content as provided (assumed to be body only, no changelog)
    if (isRequirementAppend) {
      const existingBody = file
        ? (parseChangelog(file.content)?.bodyContent ?? stripChangelogHeader(file.content))
        : "";
      const newSection = normalizeRequirementSections(content);
      bodyContent = existingBody.trimEnd()
        ? `${existingBody.trimEnd()}\n\n${newSection}`
        : `# 需求分析文档\n\n${newSection}`;
    }

    const requirementCount = countRequirements(bodyContent);

    const changelogEntry: ChangelogEntry = {
      requirement_count: requirementCount,
      iteration: nextIteration,
      last_editor: agent_type || "unknown",
      timestamp: new Date(),
    };

    const fullContent =
      formatChangelogHeader(changelogEntry) + "\n" + bodyContent;

    if (file) {
      file.content = fullContent;
      file.updated_at = new Date();
      await file.save();
    } else {
      file = await ProjectFile.create({
        filename: trimmedFilename,
        content: fullContent,
        project_id: project._id,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    return NextResponse.json(serializeProjectFile(file), { status: 201 });
  } catch (error) {
    console.error("POST /api/projects/[id]/files error:", error);
    return NextResponse.json(
      { error: "保存文件失败" },
      { status: 500 }
    );
  }
}
