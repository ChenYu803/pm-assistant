import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import type { AgentType } from "@/lib/agent-constants";
import { countRequirements, FROZEN_DOCUMENT_LOCKED_MESSAGE, formatChangelogHeader, isConceptDocFile, isWorkingDocFile, parseChangelog, stripChangelogHeader, validateAgentFilename, validateFileSize, validateProductTicketContent } from "@/lib/file-helpers";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { listMysqlProjectFiles, MysqlFileTooLargeError, MysqlFrozenDocumentError, serializeMysqlProjectFile, writeMysqlProjectFile } from "@/lib/mysql-project-artifacts";

const EXCLUSION = "\n# 排除清单";
function normalizedRequirements(content: string) { let number = 0; return content.replace(/^##\s+(?:\d+[\.、]\s*)?(.+)$/gm, (_all, title: string) => `## ${++number}. ${title.trim()}`); }
function appendRequirements(existing: string, addition: string) {
  const index = addition.indexOf(EXCLUSION); const body = (index < 0 ? addition : addition.slice(0, index)).trim(); const exclusions = index < 0 ? "" : addition.slice(index + EXCLUSION.length).trim();
  const oldIndex = existing.indexOf(EXCLUSION); if (oldIndex < 0) return [existing.trim(), body, exclusions ? `${EXCLUSION}\n${exclusions}` : ""].filter(Boolean).join("\n\n");
  const oldBody = existing.slice(0, oldIndex).trim(); const oldExclusions = existing.slice(oldIndex + EXCLUSION.length).trim();
  return [oldBody, body, `${EXCLUSION}\n${[oldExclusions, exclusions].filter(Boolean).join("\n")}`].filter(Boolean).join("\n\n");
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id: projectId } = await params; if (!isMysqlId(projectId)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
    const files = await listMysqlProjectFiles(projectId, userId); if (!files) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
    return NextResponse.json(files.filter((file) => !isWorkingDocFile(file.filename) && !isConceptDocFile(file.filename)).map((file) => { const { id, filename, project_id, version, created_at, updated_at } = serializeMysqlProjectFile(file); return { id, filename, project_id, version, created_at, updated_at }; }));
  } catch (error) { console.error("GET /api/projects/[id]/files error:", error); return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id: projectId } = await params; const body = await request.json(); const { filename, content, agent_type: agentType, iteration, source_message_id: sourceMessageId } = body;
    if (!isMysqlId(projectId)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
    const filenameValidation = validateAgentFilename(filename, agentType); if (!filenameValidation.ok) return NextResponse.json({ error: filenameValidation.error }, { status: 400 });
    const contentValidation = validateFileSize(content); if (!contentValidation.ok) return NextResponse.json({ error: contentValidation.error }, { status: 413 });
    if (agentType === "ticket_splitter" && filename.startsWith("issues/")) { const ticket = validateProductTicketContent(content); if (!ticket.ok) return NextResponse.json({ error: ticket.error }, { status: 400 }); }
    const replayFixture = process.env.NODE_ENV !== "production" && process.env.AI_MODE === "replay" && request.headers.get("x-pm-assistant-test-system-write") === "1";
    if ((typeof sourceMessageId !== "string" || !isMysqlId(sourceMessageId)) && !replayFixture) return NextResponse.json({ error: "Agent 文件写入必须提供已完成的来源消息" }, { status: 400 });
    const trimmedFilename = filename.trim();
    const working = isWorkingDocFile(trimmedFilename);
    const append = agentType === "requirement_analyst" && !working;
    const result = await writeMysqlProjectFile({
      projectId,
      userId,
      filename: trimmedFilename,
      content,
      buildContent: (existing) => {
        let bodyContent = working ? content.trim() : content;
        if (append) {
          const previous = existing ? (parseChangelog(existing.content)?.bodyContent ?? stripChangelogHeader(existing.content)) : "";
          bodyContent = previous ? appendRequirements(previous, normalizedRequirements(content)) : `# 需求分析文档\n\n${normalizedRequirements(content)}`;
        }
        if (working) return bodyContent;
        const previousIteration = existing ? parseChangelog(existing.content)?.entry.iteration ?? 0 : 0;
        return `${formatChangelogHeader({ requirement_count: countRequirements(bodyContent), iteration: iteration ?? (append ? previousIteration || 1 : previousIteration + 1), last_editor: agentType, timestamp: new Date() })}\n${bodyContent}`;
      },
      agentType: agentType as AgentType,
      ...(typeof sourceMessageId === "string" && isMysqlId(sourceMessageId) ? { sourceMessageId } : {}),
      allowReplayFixture: replayFixture,
      forceReplayFailure: process.env.NODE_ENV !== "production" && request.headers.get("x-pm-verify-mysql-write-fail") === "1",
    });
    if (result.kind === "not-found") return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
    if (result.kind === "missing-source") return NextResponse.json({ error: "Agent 文件写入必须提供已完成的来源消息" }, { status: 400 });
    if (result.kind === "invalid-source") return NextResponse.json({ error: "来源消息不存在、尚未完成或与写入 Agent/项目不匹配" }, { status: 409 });
    return NextResponse.json({ ...serializeMysqlProjectFile(result.file), ...(result.write ? { messageFileWrite: { id: result.write.id, filename: result.write.filename, operation: result.write.operation, fileVersion: Number(result.write.file_version), messageStatus: result.write.message_status, writeStatus: result.write.write_status, writtenAt: result.write.written_at } } : {}) }, { status: 201 });
  } catch (error) { if (error instanceof MysqlFrozenDocumentError) return NextResponse.json({ error: FROZEN_DOCUMENT_LOCKED_MESSAGE }, { status: 409 }); if (error instanceof MysqlFileTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 }); console.error("POST /api/projects/[id]/files error:", error); return NextResponse.json({ error: "保存文件失败" }, { status: 500 }); }
}
