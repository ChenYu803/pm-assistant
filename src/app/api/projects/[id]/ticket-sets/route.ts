import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { PRODUCT_TICKET_RE, validateFileSize, validateProductTicketContent } from "@/lib/file-helpers";
import { isMysqlId } from "@/lib/identifiers";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { deliverMysqlTicketSet, listMysqlTicketSets, MysqlFileTooLargeError, serializeMysqlProjectFile } from "@/lib/mysql-project-artifacts";
import { listMysqlProductIterations } from "@/lib/mysql-account-workspace";
import { listMysqlTaskFolders } from "@/lib/mysql-task-folders";

type Ticket = { filename: string; content: string };
function validate(candidates: unknown): { ok: true; candidates: Ticket[] } | { ok: false; error: string } {
  if (!Array.isArray(candidates) || !candidates.length) return { ok: false, error: "ticket 候选集合不能为空" };
  const tickets: Ticket[] = [];
  const filenames = new Set<string>();
  for (const item of candidates) {
    if (!item || typeof item !== "object") return { ok: false, error: "ticket 候选格式无效" };
    const { filename, content } = item as Partial<Ticket>;
    if (typeof filename !== "string" || !PRODUCT_TICKET_RE.test(filename)) return { ok: false, error: "ticket 文件名必须是 issues/NN-<slug>.md" };
    if (filenames.has(filename)) return { ok: false, error: "ticket 候选集合包含重复文件" };
    filenames.add(filename);
    const size = validateFileSize(content);
    if (!size.ok) return size;
    const contract = validateProductTicketContent(content);
    if (!contract.ok) return contract;
    tickets.push({ filename, content: (content as string).trim() });
  }
  const numbers = tickets.map(({ filename }) => Number(filename.match(/^issues\/(\d{2})-/u)?.[1])).sort((a, b) => a - b);
  if (numbers[0] !== 1 || numbers.some((number, index) => number !== index + 1)) return { ok: false, error: "ticket 候选集合必须从 01 开始连续编号" };
  return { ok: true, candidates: tickets.sort((a, b) => a.filename.localeCompare(b.filename, "en")) };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id } = await params; if (!isMysqlId(id)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
    const sets = await listMysqlTicketSets(id, userId);
    return sets ? NextResponse.json(sets) : NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
  } catch (error) { console.error("GET /api/projects/[id]/ticket-sets error:", error); return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth(); if (userId instanceof NextResponse) return userId;
    const { id } = await params; const body = await request.json().catch(() => null);
    if (!isMysqlId(id)) return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
    if (!body || (body.mode !== "replace" && body.mode !== "save")) return NextResponse.json({ error: "ticket 交付操作无效" }, { status: 400 });
    if ((await listMysqlProductIterations(id, userId))?.length || (await listMysqlTaskFolders(id, userId))?.length) {
      return NextResponse.json({ error: "请在所属产品迭代中提交整套任务" }, { status: 409 });
    }
    const candidates = validate(body.candidates);
    if (!candidates.ok) return NextResponse.json({ error: candidates.error }, { status: 400 });
    if (!isMysqlId(body.source_message_id ?? "")) return NextResponse.json({ error: "来源消息参数无效" }, { status: 400 });
    const result = await deliverMysqlTicketSet({ projectId: id, userId, sourceMessageId: body.source_message_id, mode: body.mode, candidates: candidates.candidates });
    if (result.kind === "project-not-found") return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
    if (result.kind === "invalid-source") return NextResponse.json({ error: "来源消息不是当前项目已完成的任务拆分回复" }, { status: 409 });
    return NextResponse.json({ mode: body.mode, version: result.version, currentVersion: result.currentVersion, files: result.written.map(({ file }) => serializeMysqlProjectFile(file)), writes: result.written.map(({ write }) => ({ id: write.id, filename: write.filename, operation: write.operation, fileVersion: Number(write.file_version), messageStatus: write.message_status, writeStatus: write.write_status })) }, { status: 201 });
  } catch (error) { if (error instanceof MysqlFileTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 }); console.error("POST /api/projects/[id]/ticket-sets error:", error); return NextResponse.json({ error: "交付 ticket 版本失败" }, { status: 500 }); }
}
