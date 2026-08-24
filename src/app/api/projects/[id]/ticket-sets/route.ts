import { NextResponse } from "next/server";
import mongoose, { type ClientSession } from "mongoose";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Message from "@/models/Message";
import MessageFileWrite from "@/models/MessageFileWrite";
import ProjectFile, { formatChangelogHeader } from "@/models/ProjectFile";
import Tab from "@/models/Tab";
import WorkRecord from "@/models/WorkRecord";
import { acquireProjectWriteLease } from "@/lib/deletion-coordination";
import { findOwnedProject, parseObjectId } from "@/lib/ownership";
import {
  PRODUCT_TICKET_RE,
  serializeProjectFile,
  ticketSetVersion,
  validateFileSize,
  validateProductTicketContent,
} from "@/lib/file-helpers";
import { isMysqlId } from "@/lib/identifiers";
import { deliverMysqlTicketSet, listMysqlTicketSets, serializeMysqlProjectFile } from "@/lib/mysql-project-artifacts";

type TicketCandidate = { filename: string; content: string };
type DeliveryMode = "replace" | "save";

function isTransactionUnsupported(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /transaction numbers are only allowed|transactions?.*not supported|replica set member or mongos|retryable writes/i.test(text);
}

function sessionOptions(session?: ClientSession) {
  return session ? { session } : undefined;
}

function serializeWrite(write: {
  _id: { toString(): string };
  filename: string;
  operation: "create" | "update";
  file_version: number;
}) {
  return {
    id: write._id.toString(),
    filename: write.filename,
    operation: write.operation,
    fileVersion: write.file_version,
    messageStatus: "completed" as const,
    writeStatus: "written" as const,
  };
}

function validateCandidateSet(candidates: unknown):
  | { ok: true; candidates: TicketCandidate[] }
  | { ok: false; error: string } {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { ok: false, error: "ticket 候选集合不能为空" };
  }
  const normalized: TicketCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      return { ok: false, error: "ticket 候选格式无效" };
    }
    const filename = (candidate as { filename?: unknown }).filename;
    const content = (candidate as { content?: unknown }).content;
    if (typeof filename !== "string" || !PRODUCT_TICKET_RE.test(filename)) {
      return { ok: false, error: "ticket 文件名必须是 issues/NN-<slug>.md" };
    }
    if (seen.has(filename)) {
      return { ok: false, error: "ticket 候选集合包含重复文件" };
    }
    seen.add(filename);
    const size = validateFileSize(content);
    if (!size.ok) return size;
    const contract = validateProductTicketContent(content);
    if (!contract.ok) return contract;
    normalized.push({ filename, content: (content as string).trim() });
  }
  normalized.sort((a, b) => a.filename.localeCompare(b.filename, "en"));
  const numbers = normalized.map((candidate) => Number(candidate.filename.match(/^issues\/(\d{2})-/u)?.[1]));
  if (numbers[0] !== 1 || numbers.some((number, index) => number !== index + 1)) {
    return { ok: false, error: "ticket 候选集合必须从 01 开始连续编号" };
  }
  return { ok: true, candidates: normalized };
}

async function sourceForTicketSet(
  sourceMessageId: mongoose.Types.ObjectId,
  projectId: mongoose.Types.ObjectId,
  userId: string
) {
  const source = await Message.findOne({
    _id: sourceMessageId,
    role: "assistant",
    status: "completed",
  })
    .select({ _id: 1, tab_id: 1 })
    .lean();
  if (!source) return { error: "来源消息不存在或尚未完成", status: 409 as const };
  const tab = await Tab.findById(source.tab_id)
    .select({ _id: 1, work_record_id: 1, agent_type: 1 })
    .lean();
  if (!tab || tab.agent_type !== "ticket_splitter") {
    return { error: "来源消息必须来自任务拆分 Agent", status: 400 as const };
  }
  const workRecord = await WorkRecord.findById(tab.work_record_id)
    .select({ project_id: 1 })
    .lean();
  if (!workRecord || workRecord.project_id.toString() !== projectId.toString()) {
    return { error: "来源消息不属于当前项目", status: 400 as const };
  }
  const project = await findOwnedProject(projectId.toString(), userId);
  if (!project) return { error: "项目不存在或无权访问", status: 404 as const };
  return { source, tab };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id } = await params;
    if (isMysqlId(id)) {
      const sets = await listMysqlTicketSets(id, userId);
      if (!sets) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
      return NextResponse.json(sets);
    }
    await dbConnect();
    const project = await findOwnedProject(id, userId);
    if (!project) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
    const files = await ProjectFile.find({
      project_id: project._id,
      filename: /^issues\//u,
    })
      .sort({ filename: 1 })
      .lean();
    const groups = new Map<number, typeof files>();
    for (const file of files) {
      const version = ticketSetVersion(file.filename);
      const group = groups.get(version) ?? [];
      group.push(file);
      groups.set(version, group);
    }
    const versions = [...groups.keys()].sort((a, b) => a - b);
    const currentVersion = versions.at(-1) ?? 0;
    return NextResponse.json({
      currentVersion,
      versions: versions.map((version) => ({
        version,
        current: version === currentVersion,
        files: (groups.get(version) ?? []).map((file) => ({
          id: file._id.toString(),
          filename: file.filename,
          version: file.version ?? 0,
          updated_at: file.updated_at,
        })),
      })),
    });
  } catch (error) {
    console.error("GET /api/projects/[id]/ticket-sets error:", error);
    return NextResponse.json({ error: "获取 ticket 版本失败" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id } = await params;
    const body = await request.json().catch(() => null) as {
      mode?: DeliveryMode;
      source_message_id?: string;
      candidates?: unknown;
    } | null;
    if (body?.mode !== "replace" && body?.mode !== "save") {
      return NextResponse.json({ error: "ticket 交付操作无效" }, { status: 400 });
    }
    const candidateSet = validateCandidateSet(body.candidates);
    if (!candidateSet.ok) return NextResponse.json({ error: candidateSet.error }, { status: 400 });

    if (isMysqlId(id)) {
      if (!isMysqlId(body.source_message_id ?? "")) return NextResponse.json({ error: "来源消息参数无效" }, { status: 400 });
      const result = await deliverMysqlTicketSet({ projectId: id, userId, sourceMessageId: body.source_message_id!, mode: body.mode, candidates: candidateSet.candidates });
      if (result.kind === "project-not-found") return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
      if (result.kind === "invalid-source") return NextResponse.json({ error: "来源消息不是当前项目已完成的任务拆分回复" }, { status: 409 });
      return NextResponse.json({
        mode: body.mode,
        version: result.version,
        currentVersion: result.currentVersion,
        files: result.written.map(({ file }) => serializeMysqlProjectFile(file)),
        writes: result.written.map(({ write }) => ({ id: write.id, filename: write.filename, operation: write.operation, fileVersion: Number(write.file_version), messageStatus: write.message_status, writeStatus: write.write_status })),
      }, { status: 201 });
    }
    const sourceMessageId = parseObjectId(body.source_message_id ?? "");
    if (!sourceMessageId) return NextResponse.json({ error: "来源消息参数无效" }, { status: 400 });

    await dbConnect();
    const lease = await acquireProjectWriteLease(id, userId);
    if (!lease) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
    const project = lease.project;
    try {
      const sourceResult = await sourceForTicketSet(sourceMessageId, project._id, userId);
      if ("error" in sourceResult) return NextResponse.json({ error: sourceResult.error }, { status: sourceResult.status });
      const allTicketFiles = await ProjectFile.find({ project_id: project._id, filename: /^issues\//u }).lean();
      const currentVersion = allTicketFiles.reduce((max, file) => Math.max(max, ticketSetVersion(file.filename)), 0);
      const version = body.mode === "save" ? currentVersion + 1 : 0;
      const targetFiles = candidateSet.candidates.map((candidate) => ({
        ...candidate,
        filename: body.mode === "save"
          ? `issues/v${version}/${candidate.filename.slice("issues/".length)}`
          : candidate.filename,
      }));
      const oldRootFiles = body.mode === "replace"
        ? allTicketFiles.filter((file) => ticketSetVersion(file.filename) === 0 && !targetFiles.some((candidate) => candidate.filename === file.filename))
        : [];
      const touchedFileIds = allTicketFiles
        .filter((file) => oldRootFiles.some((old) => old._id.toString() === file._id.toString()) || targetFiles.some((candidate) => candidate.filename === file.filename))
        .map((file) => file._id);
      const oldTouchedFiles = allTicketFiles.filter((file) => touchedFileIds.some((id) => id.toString() === file._id.toString()));
      const oldTouchedWrites = await MessageFileWrite.find({ project_file_id: { $in: touchedFileIds } }).lean();
      const written: Array<Awaited<ReturnType<typeof writeOne>>> = [];
      const writeOne = async (candidate: TicketCandidate, session?: ClientSession) => {
        const existing = await ProjectFile.findOne({ project_id: project._id, filename: candidate.filename }).setOptions(sessionOptions(session) ?? {});
        const operation: "create" | "update" = existing ? "update" : "create";
        const nextVersion = (existing?.version ?? 0) + 1;
        const now = new Date();
        const content = `${formatChangelogHeader({ requirement_count: 0, iteration: nextVersion, last_editor: "ticket_splitter", timestamp: now })}\n${candidate.content}`;
        const file = existing
          ? await ProjectFile.findOneAndUpdate(
              { _id: existing._id, project_id: project._id },
              { $set: { content, updated_at: now }, $inc: { version: 1 } },
              { returnDocument: "after", ...sessionOptions(session) }
            )
          : await (async () => {
              const created = new ProjectFile({ filename: candidate.filename, content, project_id: project._id, version: 1, created_at: now, updated_at: now });
              await created.save(sessionOptions(session));
              return created;
            })();
        if (!file) throw new Error("ticket 文件写入失败");
        const writeData = {
          message_id: sourceResult.source._id,
          tab_id: sourceResult.tab._id,
          project_id: project._id,
          project_file_id: file._id,
          filename: candidate.filename,
          operation,
          file_version: file.version,
          message_status: "completed" as const,
          write_status: "written" as const,
          written_at: now,
        };
        const provenance = session
          ? await new MessageFileWrite(writeData).save({ session })
          : await MessageFileWrite.create(writeData);
        return { file, provenance };
      };
      const removeOld = async (session?: ClientSession) => {
        if (oldRootFiles.length === 0) return;
        const ids = oldRootFiles.map((file) => file._id);
        await MessageFileWrite.deleteMany({ project_file_id: { $in: ids } }).setOptions(sessionOptions(session) ?? {});
        await ProjectFile.deleteMany({ _id: { $in: ids }, project_id: project._id }).setOptions(sessionOptions(session) ?? {});
      };
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await removeOld(session);
          for (const candidate of targetFiles) written.push(await writeOne(candidate, session));
        });
      } catch (error) {
        if (!isTransactionUnsupported(error)) throw error;
        // 独立 MongoDB 回退：保存旧集合，失败时按文件 ID 恢复，避免半套交付。
        written.length = 0;
        const oldSnapshot = oldTouchedFiles;
        const createdIds: mongoose.Types.ObjectId[] = [];
        try {
          await removeOld();
          for (const candidate of targetFiles) {
            const result = await writeOne(candidate);
            written.push(result);
            createdIds.push(result.file._id);
          }
        } catch (writeError) {
          await MessageFileWrite.deleteMany({ project_file_id: { $in: createdIds } });
          await ProjectFile.deleteMany({ _id: { $in: createdIds } });
          if (oldSnapshot.length > 0) await ProjectFile.insertMany(oldSnapshot);
          if (oldTouchedWrites.length > 0) await MessageFileWrite.insertMany(oldTouchedWrites);
          throw writeError;
        }
      } finally {
        await session.endSession();
      }
      return NextResponse.json({
        mode: body.mode,
        version,
        currentVersion: body.mode === "save" ? version : currentVersion,
        files: written.map(({ file }) => serializeProjectFile(file)),
        writes: written.map(({ provenance }) => serializeWrite(provenance)),
      }, { status: 201 });
    } finally {
      await lease.release();
    }
  } catch (error) {
    console.error("POST /api/projects/[id]/ticket-sets error:", error);
    return NextResponse.json({ error: "交付 ticket 版本失败" }, { status: 500 });
  }
}
