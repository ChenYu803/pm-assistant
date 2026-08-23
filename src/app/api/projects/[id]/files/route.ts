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
import {
  serializeProjectFile,
  stripChangelogHeader,
  isWorkingDocFile,
  validateAgentFilename,
  validateFileSize,
} from "@/lib/file-helpers";
import {
  FROZEN_DOCUMENT_LOCKED_MESSAGE,
  mutableProjectFileFilter,
} from "@/lib/freeze-document-binding";

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

/** 排除清单段标题（一级标题，normalize 只重编号 "## "，不会动它）。
 *  自带一个前导 \n 作解析锚点；join 处需再补一个 \n 保证标题前有空行，
 *  否则 markdown 会把「# 排除清单」并进上一段落而不渲染为标题。 */
const EXCLUSION_LIST_HEADING = "\n# 排除清单";

/**
 * 从 Agent 输出的新段落中拆出「排除清单」段（Agent 每轮输出都自带该段，
 * 见 agent-prompts.ts 文件产出规范）：返回剩余的需求主体与新排除条目。
 */
function splitExclusionList(
  newSection: string
): { body: string; exclusionEntries: string } {
  const idx = newSection.indexOf(EXCLUSION_LIST_HEADING);
  if (idx === -1) return { body: newSection, exclusionEntries: "" };
  return {
    body: newSection.slice(0, idx).trimEnd(),
    exclusionEntries: newSection
      .slice(idx + EXCLUSION_LIST_HEADING.length)
      .trim(),
  };
}

/**
 * 追加新需求到已有正文：需求主体插到已有「# 排除清单」段之前；Agent 新输出的
 * 排除条目合并进旧清单（追加到旧清单末尾）。保证文件结构恒定：
 * 需求条目在前、单一「# 排除清单」段在末尾（多次会话追加不产生重复段）。
 */
function appendRequirement(existingBody: string, newSection: string): string {
  const { body, exclusionEntries } = splitExclusionList(newSection);
  const idx = existingBody.indexOf(EXCLUSION_LIST_HEADING);
  if (idx === -1) {
    const rest = existingBody.trimEnd();
    if (!exclusionEntries) {
      return body ? `${rest}\n\n${body}` : rest;
    }
    return body
      ? `${rest}\n\n${body}\n${EXCLUSION_LIST_HEADING}\n${exclusionEntries}`
      : `${rest}\n${EXCLUSION_LIST_HEADING}\n${exclusionEntries}`;
  }
  // 旧清单存在：需求主体插到清单前；新排除条目追加到旧清单后（避免重复段）
  const existingList = existingBody
    .slice(idx + EXCLUSION_LIST_HEADING.length)
    .trim();
  const mergedList = [existingList, exclusionEntries]
    .filter(Boolean)
    .join("\n");
  const head = existingBody.slice(0, idx).trimEnd();
  return body
    ? `${head}\n\n${body}\n${EXCLUSION_LIST_HEADING}\n${mergedList}`
    : `${head}\n${EXCLUSION_LIST_HEADING}\n${mergedList}`;
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
        const { id, filename, project_id, created_at, updated_at } = serialized;
        return { id, filename, project_id, created_at, updated_at };
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

    const filenameValidation = validateAgentFilename(filename, agent_type);
    if (!filenameValidation.ok) {
      return NextResponse.json({ error: filenameValidation.error }, { status: 400 });
    }
    const contentValidation = validateFileSize(content);
    if (!contentValidation.ok) {
      return NextResponse.json({ error: contentValidation.error }, { status: 413 });
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
    // 工作文档（文件名含「工作文档」）是中间过程快照：整文件替换、无 changelog 头。
    const isWorkingDoc = isWorkingDocFile(trimmedFilename);
    const isRequirementAppend = agent_type === "requirement_analyst" && !isWorkingDoc;

    let bodyContent = content; // content as provided (assumed to be body only, no changelog)
    if (isWorkingDoc) {
      bodyContent = content.trim();
    } else if (isRequirementAppend) {
      const existingBody = file
        ? (parseChangelog(file.content)?.bodyContent ?? stripChangelogHeader(file.content))
        : "";
      const newSection = normalizeRequirementSections(content);
      bodyContent = existingBody.trimEnd()
        ? appendRequirement(existingBody, newSection)
        : `# 需求分析文档\n\n${newSection}`;
    }

    // 工作文档（中间快照）无 changelog 头；正式文件计算 changelog 头
    let fullContent = bodyContent;
    if (!isWorkingDoc) {
      const requirementCount = countRequirements(bodyContent);
      const changelogEntry: ChangelogEntry = {
        requirement_count: requirementCount,
        iteration:
          iteration ??
          (isRequirementAppend ? existingIteration || 1 : existingIteration + 1),
        last_editor: agent_type || "unknown",
        timestamp: new Date(),
      };
      fullContent = formatChangelogHeader(changelogEntry) + "\n" + bodyContent;
    }

    if (file) {
      const updatedAt = new Date();
      const result = await ProjectFile.collection.updateOne(
        mutableProjectFileFilter(file._id),
        { $set: { content: fullContent, updated_at: updatedAt } }
      );
      if (result.matchedCount !== 1) {
        return NextResponse.json(
          { error: FROZEN_DOCUMENT_LOCKED_MESSAGE },
          { status: 409 }
        );
      }
      file.content = fullContent;
      file.updated_at = updatedAt;
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
