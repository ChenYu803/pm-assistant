import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import ProjectFile, {
  formatChangelogHeader,
  parseChangelog,
  countRequirements,
  type ChangelogEntry,
} from "@/models/ProjectFile";
import { findOwnedProject } from "@/lib/ownership";
import { serializeProjectFile } from "@/lib/file-helpers";

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
        const serialized = serializeProjectFile(f as Parameters<typeof serializeProjectFile>[0]);
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

    // Build new changelog
    const nextIteration =
      iteration ?? (existingIteration + 1);
    const bodyContent = content; // content as provided (assumed to be body only, no changelog)
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
