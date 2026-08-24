import { NextResponse } from "next/server";
import mongoose, { type ClientSession, type Types } from "mongoose";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Message from "@/models/Message";
import MessageFileWrite from "@/models/MessageFileWrite";
import Tab from "@/models/Tab";
import WorkRecord from "@/models/WorkRecord";
import ProjectFile, {
  formatChangelogHeader,
  parseChangelog,
  countRequirements,
  type ChangelogEntry,
  type IProjectFileDocument,
} from "@/models/ProjectFile";
import { findOwnedProject, parseObjectId } from "@/lib/ownership";
import { acquireProjectWriteLease } from "@/lib/deletion-coordination";
import {
  serializeProjectFile,
  stripChangelogHeader,
  isWorkingDocFile,
  validateAgentFilename,
  validateFileSize,
  validateProductTicketContent,
} from "@/lib/file-helpers";
import {
  FROZEN_DOCUMENT_LOCKED_MESSAGE,
  mutableProjectFileFilter,
} from "@/lib/freeze-document-binding";
import { isMysqlId } from "@/lib/identifiers";
import {
  findMysqlProjectFileByFilename,
  listMysqlProjectFiles,
  serializeMysqlProjectFile,
  writeMysqlProjectFile,
} from "@/lib/mysql-project-artifacts";
import type { AgentType } from "@/lib/agent-constants";

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

class FileWriteBlockedError extends Error {
  constructor() {
    super(FROZEN_DOCUMENT_LOCKED_MESSAGE);
  }
}

function isTransactionUnsupported(error: unknown): boolean {
  const nested =
    typeof error === "object" && error !== null
      ? error as { errorResponse?: { message?: unknown }; originalError?: { message?: unknown } }
      : undefined;
  const details = [
    error instanceof Error ? error.message : String(error),
    nested?.errorResponse?.message,
    nested?.originalError?.message,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return /transaction numbers are only allowed|transactions?.*not supported|replica set member or mongos|retryable writes/i.test(
    details
  );
}

function sessionOptions(session?: ClientSession) {
  return session ? { session } : undefined;
}

function shouldInjectProvenanceWriteFailure(request: Request): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.AI_MODE === "replay" &&
    request.headers.get("x-pm-assistant-test-provenance-fail") === "1"
  );
}

function serializeMessageFileWrite(write: {
  _id: { toString(): string };
  filename: string;
  operation: "create" | "update";
  file_version: number;
  message_status: "completed";
  write_status: "written";
  written_at: Date;
}) {
  return {
    id: write._id.toString(),
    filename: write.filename,
    operation: write.operation,
    fileVersion: write.file_version,
    messageStatus: write.message_status,
    writeStatus: write.write_status,
    writtenAt: write.written_at,
  };
}

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

    if (isMysqlId(projectId)) {
      const files = await listMysqlProjectFiles(projectId, userId);
      if (!files) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
      return NextResponse.json(files.map((file) => {
        const { id, filename, project_id, created_at, updated_at } = serializeMysqlProjectFile(file);
        return { id, filename, project_id, created_at, updated_at };
      }));
    }

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
      source_message_id,
    } = body as {
      filename: string;
      content: string;
      agent_type: string;
      iteration?: number;
      source_message_id?: string;
    };

    const filenameValidation = validateAgentFilename(filename, agent_type);
    if (!filenameValidation.ok) {
      return NextResponse.json({ error: filenameValidation.error }, { status: 400 });
    }
    const contentValidation = validateFileSize(content);
    if (!contentValidation.ok) {
      return NextResponse.json({ error: contentValidation.error }, { status: 413 });
    }
    if (agent_type === "ticket_splitter" && typeof filename === "string" && filename.startsWith("issues/")) {
      const ticketValidation = validateProductTicketContent(content);
      if (!ticketValidation.ok) {
        return NextResponse.json({ error: ticketValidation.error }, { status: 400 });
      }
    }
    const sourceMessageId =
      typeof source_message_id === "string"
        ? parseObjectId(source_message_id)
        : undefined;
    const mysqlSourceMessageId =
      typeof source_message_id === "string" && isMysqlId(source_message_id)
        ? source_message_id
        : undefined;
    // replay 夹具需要创建不属于 Agent 消息的基础文件；该旁路仅限非生产回放，
    // 产品 Agent 写入仍必须提供可核验的 assistant 来源消息。
    const isReplayFixtureSystemWrite =
      !sourceMessageId && !mysqlSourceMessageId &&
      process.env.NODE_ENV !== "production" &&
      process.env.AI_MODE === "replay" &&
      request.headers.get("x-pm-assistant-test-system-write") === "1";
    if (!sourceMessageId && !mysqlSourceMessageId && !isReplayFixtureSystemWrite) {
      return NextResponse.json(
        { error: "Agent 文件写入必须提供已完成的来源消息" },
        { status: 400 }
      );
    }

    if (isMysqlId(projectId)) {
      const trimmedFilename = filename.trim();
      const existing = await findMysqlProjectFileByFilename(projectId, trimmedFilename);
      const existingIteration = existing ? (parseChangelog(existing.content)?.entry.iteration ?? 0) : 0;
      const isWorkingDoc = isWorkingDocFile(trimmedFilename);
      const isRequirementAppend = agent_type === "requirement_analyst" && !isWorkingDoc;
      let bodyContent = content;
      if (isWorkingDoc) {
        bodyContent = content.trim();
      } else if (isRequirementAppend) {
        const existingBody = existing ? (parseChangelog(existing.content)?.bodyContent ?? stripChangelogHeader(existing.content)) : "";
        const newSection = normalizeRequirementSections(content);
        bodyContent = existingBody.trimEnd() ? appendRequirement(existingBody, newSection) : `# 需求分析文档\n\n${newSection}`;
      }
      const fullContent = isWorkingDoc
        ? bodyContent
        : `${formatChangelogHeader({ requirement_count: countRequirements(bodyContent), iteration: iteration ?? (isRequirementAppend ? existingIteration || 1 : existingIteration + 1), last_editor: agent_type || "unknown", timestamp: new Date() })}\n${bodyContent}`;
      const result = await writeMysqlProjectFile({
        projectId,
        userId,
        filename: trimmedFilename,
        content: fullContent,
        agentType: agent_type as AgentType,
        ...(mysqlSourceMessageId ? { sourceMessageId: mysqlSourceMessageId } : {}),
        allowReplayFixture: isReplayFixtureSystemWrite,
      });
      if (result.kind === "not-found") return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
      if (result.kind === "missing-source") return NextResponse.json({ error: "Agent 文件写入必须提供已完成的来源消息" }, { status: 400 });
      if (result.kind === "invalid-source") return NextResponse.json({ error: "来源消息不存在、尚未完成或与写入 Agent/项目不匹配" }, { status: 409 });
      return NextResponse.json({
        ...serializeMysqlProjectFile(result.file),
        ...(result.write ? { messageFileWrite: { id: result.write.id, filename: result.write.filename, operation: result.write.operation, fileVersion: Number(result.write.file_version), messageStatus: result.write.message_status, writeStatus: result.write.write_status, writtenAt: result.write.written_at } } : {}),
      }, { status: 201 });
    }

    await dbConnect();

    const writeLease = await acquireProjectWriteLease(projectId, userId);
    if (!writeLease) {
      return NextResponse.json(
        { error: "项目不存在或无权访问" },
        { status: 404 }
      );
    }
    const project = writeLease.project;

    try {
      const trimmedFilename = filename.trim();
      let messageSource: { messageId: Types.ObjectId; tabId: Types.ObjectId } | null = null;
      if (sourceMessageId) {
        const sourceMessage = await Message.findOne({
          _id: sourceMessageId,
          role: "assistant",
        })
          .select({ _id: 1, tab_id: 1, status: 1 })
          .lean();
        if (!sourceMessage || (sourceMessage.status ?? "completed") !== "completed") {
          return NextResponse.json(
            { error: "来源消息不存在或尚未完成" },
            { status: 409 }
          );
        }
        const sourceTab = await Tab.findById(sourceMessage.tab_id)
          .select({ _id: 1, work_record_id: 1, agent_type: 1 })
          .lean();
        if (!sourceTab || sourceTab.agent_type !== agent_type) {
          return NextResponse.json(
            { error: "来源消息与写入 Agent 不匹配" },
            { status: 400 }
          );
        }
        const sourceWorkRecord = await WorkRecord.findById(sourceTab.work_record_id)
          .select({ project_id: 1 })
          .lean();
        if (
          !sourceWorkRecord ||
          sourceWorkRecord.project_id.toString() !== project._id.toString()
        ) {
          return NextResponse.json(
            { error: "来源消息不属于当前项目" },
            { status: 400 }
          );
        }
        messageSource = {
          messageId: sourceMessage._id,
          tabId: sourceTab._id,
        };
      }

    // Find existing file or create new
    const file = await ProjectFile.findOne({
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

      const originalFile = file;
      const operation: "create" | "update" = originalFile
        ? "update"
        : "create";
      const writtenAt = new Date();
      const updatedAt = new Date();

      const writeProjectFile = async (session?: ClientSession) => {
        if (originalFile) {
          // $inc 让每次写入取得实际唯一版本；来源记录只使用这次原子更新返回的版本。
          const updated = await ProjectFile.findOneAndUpdate(
            mutableProjectFileFilter(originalFile._id),
            {
              $set: { content: fullContent, updated_at: updatedAt },
              $inc: { version: 1 },
            },
            { returnDocument: "after", ...sessionOptions(session) }
          );
          if (!updated) throw new FileWriteBlockedError();
          return updated;
        }

        const creation = {
          filename: trimmedFilename,
          content: fullContent,
          project_id: project._id,
          version: 1,
          created_at: writtenAt,
          updated_at: writtenAt,
        };
        if (!session) return ProjectFile.create(creation);
        const created = new ProjectFile(creation);
        await created.save({ session });
        return created;
      };

      const createMessageFileWrite = async (
        writtenFile: IProjectFileDocument,
        session?: ClientSession
      ) => {
        const source = messageSource;
        if (!source) return null;
        if (shouldInjectProvenanceWriteFailure(request)) {
          throw new Error("回放强制消息文件来源记录失败");
        }
        const writeData = {
          message_id: source.messageId,
          tab_id: source.tabId,
          project_id: project._id,
          project_file_id: writtenFile._id,
          filename: trimmedFilename,
          operation,
          file_version: writtenFile.version,
          message_status: "completed" as const,
          write_status: "written" as const,
          written_at: writtenAt,
        };
        if (!session) return MessageFileWrite.create(writeData);
        const write = new MessageFileWrite(writeData);
        await write.save({ session });
        return write;
      };

      const rollbackProjectFileWrite = async (writtenFile: IProjectFileDocument) => {
        if (!originalFile) {
          const result = await ProjectFile.deleteOne({
            _id: writtenFile._id,
            version: writtenFile.version,
          });
          return result.deletedCount === 1;
        }
        const result = await ProjectFile.collection.updateOne(
          {
            ...mutableProjectFileFilter(writtenFile._id),
            version: writtenFile.version,
          },
          {
            $set: {
              content: originalFile.content,
              updated_at: originalFile.updated_at,
              version: originalFile.version ?? 0,
            },
          }
        );
        return result.matchedCount === 1;
      };

      let writtenFile: IProjectFileDocument;
      let messageFileWrite: Awaited<ReturnType<typeof createMessageFileWrite>> = null;
      if (!messageSource) {
        writtenFile = await writeProjectFile();
      } else {
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            writtenFile = await writeProjectFile(session);
            messageFileWrite = await createMessageFileWrite(writtenFile, session);
          });
        } catch (error) {
          if (!isTransactionUnsupported(error)) throw error;

          // 独立 MongoDB 不支持事务时，来源记录失败必须撤销这次文件写入。
          writtenFile = await writeProjectFile();
          try {
            messageFileWrite = await createMessageFileWrite(writtenFile);
          } catch (writeError) {
            if (!(await rollbackProjectFileWrite(writtenFile))) {
              throw new Error("文件来源记录失败且无法恢复文件写入", {
                cause: writeError,
              });
            }
            throw writeError;
          }
        } finally {
          await session.endSession();
        }
      }

      return NextResponse.json(
        {
          ...serializeProjectFile(writtenFile!),
          ...(messageFileWrite
            ? { messageFileWrite: serializeMessageFileWrite(messageFileWrite) }
            : {}),
        },
        { status: 201 }
      );
    } finally {
      await writeLease.release();
    }
  } catch (error) {
    if (error instanceof FileWriteBlockedError) {
      return NextResponse.json(
        { error: FROZEN_DOCUMENT_LOCKED_MESSAGE },
        { status: 409 }
      );
    }
    console.error("POST /api/projects/[id]/files error:", error);
    return NextResponse.json(
      { error: "保存文件失败" },
      { status: 500 }
    );
  }
}
