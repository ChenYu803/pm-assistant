import { createHash, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

import { validateFileSize, validateProductTicketContent } from "@/lib/file-helpers";
import { getMysqlPool } from "@/lib/mysql";

type Proposal = { number: number; suffix: string; content: string };
type Issue = { id: string; issue_number: number; filename: string; content: string; version: number };
type Folder = { id: string; next_issue_number: number; owner_iteration_number: number };
type CandidateRow = RowDataPacket & {
  id: string; message_id: string; session_id: string; proposed_files: string;
  status: "pending" | "discarded" | "written"; project_id: string; iteration_number: number;
  iteration_name: string; session_name: string;
  source_role: "user" | "assistant";
};

const BLOCK = /^%%%FILE_BEGIN%%%[ \t]*issues\/(\d+)-([^/\\\r\n]+)\.md[ \t]*\r?\n([\s\S]*?)^%%%FILE_END%%%[ \t]*$/gm;
const BLOCKED_BY_FIELD = /^[ \t]*\*\*Blocked by:\*\*[^\r\n]*/im;
const WHAT_TO_BUILD_FIELD = /^[ \t]*\*\*What to build:\*\*[ \t]*([^\r\n]*)/im;
const MAX_SET_BYTES = 12 * 1024 * 1024;

/** Agent 编号是候选引用；新 issue 的耐久编号只由文件夹计数器分配。 */
export function extractTaskSet(answer: string): Proposal[] | null {
  if (answer.trim() === "%%%TASK_SET_EMPTY%%%") return [];
  const starts = answer.match(/^%%%FILE_BEGIN%%%/gm)?.length ?? 0;
  if (!starts || starts !== (answer.match(/^%%%FILE_END%%%/gm)?.length ?? 0)) return null;
  const matches = [...answer.matchAll(BLOCK)];
  if (matches.length !== starts) return null;
  const numbers = new Set<number>();
  const files: Proposal[] = [];
  for (const match of matches) {
    const number = Number(match[1]);
    const suffix = match[2];
    const content = match[3].replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    if (!Number.isSafeInteger(number) || number < 1 || number > 4294967294 || numbers.has(number)
      || suffix.length > 180 || suffix !== suffix.trim() || /[\u0000-\u001f]/u.test(suffix)
      || !validateFileSize(content).ok || !validateProductTicketContent(content).ok
      || !content.match(WHAT_TO_BUILD_FIELD)?.[1]?.trim()
      || !content.match(BLOCKED_BY_FIELD)?.[0]?.replace(/^[ \t]*\*\*Blocked by:\*\*/i, "").trim()
      || !/^[ \t]*-[ \t]+\[[ xX]\][ \t]+\S/m.test(content)) return null;
    numbers.add(number);
    files.push({ number, suffix, content });
  }
  for (const file of files) {
    const line = file.content.match(BLOCKED_BY_FIELD)?.[0] ?? "";
    if ([...line.matchAll(/#(\d+)/g)].some((reference) => !numbers.has(Number(reference[1])))) return null;
  }
  return Buffer.byteLength(JSON.stringify(files), "utf8") <= MAX_SET_BYTES ? files : null;
}

export function withoutTaskSetBlocks(answer: string) {
  return answer.replace(BLOCK, "").replace("%%%TASK_SET_EMPTY%%%", "").replace(/\n{3,}/g, "\n\n").trim();
}

export async function createTaskSetCandidate(connection: PoolConnection, input: { messageId: string; sessionId: string; answer: string }) {
  const files = extractTaskSet(input.answer);
  if (!files) return;
  await connection.execute(
    "INSERT INTO iteration_task_set_candidates (id, message_id, session_id, proposed_files) VALUES (?, ?, ?, ?)",
    [randomUUID(), input.messageId, input.sessionId, JSON.stringify(files)],
  );
}

export async function listTaskSetCandidates(sessionId: string) {
  const [rows] = await getMysqlPool().query<Array<RowDataPacket & { id: string; message_id: string; status: string }>>(
    "SELECT id, message_id, status FROM iteration_task_set_candidates WHERE session_id = ?", [sessionId],
  );
  return new Map(rows.map((row) => [row.message_id, { id: row.id, status: row.status }]));
}

/** 手动草稿读取当前整套，删除某块即提出删除该 issue。 */
export async function getManualTaskSetDraft(input: { iterationId: string; sessionId: string; userId: string }) {
  const [rows] = await getMysqlPool().query<Array<RowDataPacket & { project_id: string; iteration_number: number }>>(
    `SELECT i.project_id, i.iteration_number FROM iteration_sessions s
     JOIN product_iterations i ON i.id = s.iteration_id JOIN projects p ON p.id = i.project_id
     WHERE s.id = ? AND i.id = ? AND s.stage = 'tasks' AND p.user_id = ?`,
    [input.sessionId, input.iterationId, input.userId],
  );
  if (!rows.length) return null;
  const [issues] = await getMysqlPool().query<Array<RowDataPacket & { filename: string; content: string; issue_number: number }>>(
    `SELECT f.filename, f.content, f.issue_number FROM project_files f JOIN task_folders tf ON tf.id = f.task_folder_id
     WHERE tf.project_id = ? AND tf.owner_iteration_id = ? ORDER BY f.issue_number`,
    [rows[0].project_id, input.iterationId],
  );
  const draft = issues.length ? issues.map((issue) => {
    const name = issue.filename.slice(issue.filename.lastIndexOf("/") + 1);
    return `%%%FILE_BEGIN%%% issues/${name}\n${issue.content}\n%%%FILE_END%%%`;
  }).join("\n\n") : "";
  return { draft, files: issues.map((issue) => ({ number: Number(issue.issue_number),
    suffix: issue.filename.slice(issue.filename.lastIndexOf("/") + 1).replace(/^\d+-|\.md$/g, ""), content: issue.content })) };
}

export async function createManualTaskSetCandidate(input: { iterationId: string; sessionId: string; userId: string; answer: string }) {
  const files = extractTaskSet(input.answer);
  if (!files) return { kind: "invalid" as const };
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [lookup] = await connection.query<Array<RowDataPacket & { project_id: string }>>(
      "SELECT project_id FROM product_iterations WHERE id = ?", [input.iterationId],
    );
    const projectId = lookup[0]?.project_id;
    if (!projectId) { await connection.rollback(); return { kind: "not-found" as const }; }
    const [projects] = await connection.query<RowDataPacket[]>("SELECT id FROM projects WHERE id = ? AND user_id = ? FOR UPDATE", [projectId, input.userId]);
    if (!projects.length) { await connection.rollback(); return { kind: "not-found" as const }; }
    const [iterations] = await connection.query<RowDataPacket[]>("SELECT id FROM product_iterations WHERE id = ? AND project_id = ? FOR UPDATE", [input.iterationId, projectId]);
    if (!iterations.length) { await connection.rollback(); return { kind: "not-found" as const }; }
    const [sessions] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM iteration_sessions WHERE id = ? AND iteration_id = ? AND stage = 'tasks' FOR UPDATE", [input.sessionId, input.iterationId],
    );
    if (!sessions.length) { await connection.rollback(); return { kind: "not-found" as const }; }
    const [stage] = await connection.query<Array<RowDataPacket & { status: string }>>(
      "SELECT status FROM iteration_stage_states WHERE iteration_id = ? AND stage = 'tasks'", [input.iterationId],
    );
    if (stage[0]?.status === "completed") { await connection.rollback(); return { kind: "stage-completed" as const }; }
    const [generating] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM iteration_session_messages WHERE session_id = ? AND status = 'generating' LIMIT 1", [input.sessionId],
    );
    if (generating.length) { await connection.rollback(); return { kind: "generating" as const }; }
    const [latest] = await connection.query<Array<RowDataPacket & { created_at: Date }>>(
      "SELECT created_at FROM iteration_session_messages WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", [input.sessionId],
    );
    const now = new Date();
    const latestTime = latest[0]?.created_at?.getTime() ?? 0;
    const createdAt = new Date(Math.max(now.getTime(), latestTime + 1));
    const messageId = randomUUID(); const candidateId = randomUUID();
    await connection.execute(
      "INSERT INTO iteration_session_messages (id, session_id, role, content, status, created_at) VALUES (?, ?, 'user', ?, 'completed', ?)",
      [messageId, input.sessionId, input.answer, createdAt],
    );
    await connection.execute(
      "INSERT INTO iteration_task_set_candidates (id, message_id, session_id, proposed_files) VALUES (?, ?, ?, ?)",
      [candidateId, messageId, input.sessionId, JSON.stringify(files)],
    );
    await connection.execute("UPDATE iteration_sessions SET updated_at = ? WHERE id = ?", [createdAt, input.sessionId]);
    await connection.commit();
    return { kind: "created" as const, candidateId };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

function fingerprint(folder: Folder | null, current: Issue[]) {
  return createHash("sha256").update(JSON.stringify({ folder: folder?.id ?? null,
    next: folder?.next_issue_number ?? 1, issues: current.map((issue) => [issue.id, issue.filename, issue.content, issue.version]) })).digest("hex");
}

function canonicalContent(content: string, assigned: number, numberMap: Map<number, number>) {
  return content
    .replace(/^(#[ \t]+)\d+(?=[ \t]*[—–-])/m, (_, heading: string) => `${heading}${String(assigned).padStart(2, "0")}`)
    .replace(BLOCKED_BY_FIELD, (line) => line.replace(/#(\d+)/g, (ref: string, raw: string) => {
      const mapped = numberMap.get(Number(raw));
      return mapped === undefined ? ref : `#${String(mapped).padStart(2, "0")}`;
    }));
}

function plan(proposed: Proposal[], folder: Folder | null, current: Issue[]) {
  const existingByNumber = new Map(current.map((issue) => [issue.issue_number, issue]));
  const proposedNumbers = new Set(proposed.map((file) => file.number));
  const numberMap = new Map<number, number>();
  let next = folder?.next_issue_number ?? 1;
  for (const file of proposed) if (existingByNumber.has(file.number)) numberMap.set(file.number, file.number);
  for (const file of [...proposed].sort((a, b) => a.number - b.number)) {
    if (!existingByNumber.has(file.number)) numberMap.set(file.number, next++);
  }
  const prefix = `issues/iteration-${folder?.owner_iteration_number ?? 0}/`;
  const entries = proposed.map((file) => {
    const issue = existingByNumber.get(file.number);
    const number = numberMap.get(file.number)!;
    const filename = `${prefix}${String(number).padStart(2, "0")}-${file.suffix}.md`;
    const content = canonicalContent(file.content, number, numberMap);
    const change = !issue ? "create" : issue.content !== content && issue.filename !== filename ? "content-and-rename"
      : issue.content !== content ? "content" : issue.filename !== filename ? "rename" : "unchanged";
    return { number, filename, content, change, previousFilename: issue?.filename ?? null, id: issue?.id ?? null,
      revision: issue?.version ?? null };
  });
  const deleted = current.filter((issue) => !proposedNumbers.has(issue.issue_number)).map((issue) => ({
    number: issue.issue_number, filename: issue.filename, content: issue.content, change: "delete" as const,
    previousFilename: issue.filename, id: issue.id, revision: issue.version,
  }));
  return { entries, deleted, next };
}

async function loadCandidate(connection: PoolConnection, input: { iterationId: string; sessionId: string; candidateId: string; projectId: string }, lock: boolean) {
  const [rows] = await connection.query<CandidateRow[]>(
    `SELECT c.*, s.title AS session_name, i.project_id, i.iteration_number, i.display_name AS iteration_name,
       m.role AS source_role
     FROM iteration_task_set_candidates c JOIN iteration_sessions s ON s.id = c.session_id
     JOIN iteration_session_messages m ON m.id = c.message_id
     JOIN product_iterations i ON i.id = s.iteration_id
     WHERE c.id = ? AND c.session_id = ? AND i.id = ? AND i.project_id = ? AND s.stage = 'tasks' ${lock ? "FOR UPDATE" : ""}`,
    [input.candidateId, input.sessionId, input.iterationId, input.projectId],
  );
  return rows[0] ?? null;
}

async function loadFolderAndIssues(connection: PoolConnection, projectId: string, iterationId: string, lock: boolean) {
  const [folders] = await connection.query<Array<RowDataPacket & Folder>>(
    `SELECT id, next_issue_number, owner_iteration_number FROM task_folders WHERE project_id = ? AND owner_iteration_id = ? ${lock ? "FOR UPDATE" : ""}`,
    [projectId, iterationId],
  );
  const folder = folders[0] ?? null;
  const [rows] = folder ? await connection.query<Array<RowDataPacket & Issue>>(
    `SELECT id, issue_number, filename, content, version FROM project_files WHERE task_folder_id = ? ORDER BY issue_number ${lock ? "FOR UPDATE" : ""}`,
    [folder.id],
  ) : [[] as Array<RowDataPacket & Issue>];
  return { folder, current: rows.map((row) => ({ ...row, issue_number: Number(row.issue_number), version: Number(row.version) })) };
}

export async function previewTaskSetCandidate(input: { iterationId: string; sessionId: string; candidateId: string; userId: string }) {
  const connection = await getMysqlPool().getConnection();
  try {
    const [iterations] = await connection.query<Array<RowDataPacket & { project_id: string; iteration_number: number }>>(
      `SELECT i.project_id, i.iteration_number FROM product_iterations i JOIN projects p ON p.id = i.project_id
       WHERE i.id = ? AND p.user_id = ?`, [input.iterationId, input.userId],
    );
    const iteration = iterations[0];
    if (!iteration) return { kind: "not-found" as const };
    const candidate = await loadCandidate(connection, { ...input, projectId: iteration.project_id }, false);
    if (!candidate) return { kind: "not-found" as const };
    const { folder, current } = await loadFolderAndIssues(connection, iteration.project_id, input.iterationId, false);
    const proposed = JSON.parse(candidate.proposed_files) as Proposal[];
    const result = plan(proposed, folder ?? { id: "", next_issue_number: 1, owner_iteration_number: iteration.iteration_number }, current);
    return { kind: "preview" as const, status: candidate.status, fingerprint: fingerprint(folder, current),
      entries: result.entries, deleted: result.deleted, folderId: folder?.id ?? null };
  } finally { connection.release(); }
}

export async function decideTaskSetCandidate(input: {
  iterationId: string; sessionId: string; candidateId: string; userId: string;
  action: "write" | "discard"; expectedFingerprint?: string; forceFailure?: boolean;
}) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [lookup] = await connection.query<Array<RowDataPacket & { project_id: string }>>(
      "SELECT project_id FROM product_iterations WHERE id = ?", [input.iterationId],
    );
    const projectId = lookup[0]?.project_id;
    if (!projectId) { await connection.rollback(); return { kind: "not-found" as const }; }
    const [projects] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM projects WHERE id = ? AND user_id = ? FOR UPDATE", [projectId, input.userId],
    );
    if (!projects.length) { await connection.rollback(); return { kind: "not-found" as const }; }
    const [iterations] = await connection.query<Array<RowDataPacket & { iteration_number: number; display_name: string }>>(
      "SELECT iteration_number, display_name FROM product_iterations WHERE id = ? AND project_id = ? FOR UPDATE",
      [input.iterationId, projectId],
    );
    const iteration = iterations[0];
    if (!iteration) { await connection.rollback(); return { kind: "not-found" as const }; }
    const { folder: existingFolder, current } = await loadFolderAndIssues(connection, projectId, input.iterationId, true);
    const candidate = await loadCandidate(connection, { ...input, projectId }, true);
    if (!candidate) { await connection.rollback(); return { kind: "not-found" as const }; }
    if (candidate.status !== "pending") { await connection.rollback(); return { kind: "decided" as const }; }
    if (input.action === "discard") {
      await connection.execute("UPDATE iteration_task_set_candidates SET status = 'discarded', decided_at = ? WHERE id = ?", [new Date(), candidate.id]);
      await connection.commit();
      return { kind: "discarded" as const };
    }
    if (input.expectedFingerprint !== fingerprint(existingFolder, current)) {
      await connection.rollback(); return { kind: "stale" as const };
    }
    const folder: Folder = existingFolder ?? { id: randomUUID(), owner_iteration_number: Number(iteration.iteration_number), next_issue_number: 1 };
    const proposed = JSON.parse(candidate.proposed_files) as Proposal[];
    const result = plan(proposed, folder, current);
    if (result.next > 4294967295) { await connection.rollback(); return { kind: "number-exhausted" as const }; }
    for (const entry of result.entries) if (!validateFileSize(entry.content).ok) {
      await connection.rollback(); return { kind: "too-large" as const };
    }
    if (!existingFolder) await connection.execute(
      `INSERT INTO task_folders (id, project_id, owner_iteration_id, owner_iteration_number, owner_iteration_name)
       VALUES (?, ?, ?, ?, ?)`, [folder.id, projectId, input.iterationId, iteration.iteration_number, iteration.display_name],
    );
    const groupId = randomUUID(); const now = new Date();
    const changed = result.entries.some((entry) => entry.change !== "unchanged") || result.deleted.length > 0;
    if (changed) {
      await connection.execute("UPDATE task_folders SET previous_snapshot = ?, next_issue_number = ? WHERE id = ?",
        [JSON.stringify(current), result.next, folder.id]);
      const record = async (entry: { id: string; filename: string; previousFilename: string | null; action: string; revision: number | null }) => {
        await connection.execute(
          `INSERT INTO project_file_changes (id, project_id, file_id, task_change_group_id, task_folder_id, operation,
            filename, previous_filename, content_revision, actor, iteration_id, iteration_number, iteration_name,
            stage, session_id, session_name, message_id, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tickets', ?, ?, ?, ?)`,
          [randomUUID(), projectId, entry.id, groupId, folder.id, entry.action, entry.filename, entry.previousFilename,
            entry.revision, candidate.source_role === "user" ? "user" : "agent", input.iterationId, iteration.iteration_number, iteration.display_name,
            input.sessionId, candidate.session_name, candidate.message_id, now],
        );
      };
      for (const issue of result.deleted) {
        await connection.execute("DELETE FROM project_files WHERE id = ? AND project_id = ?", [issue.id, projectId]);
        await record({ id: issue.id, filename: issue.filename, previousFilename: null, action: "delete", revision: null });
      }
      // 所有改名先让出原路径，避免两个 issue 交换描述时触发唯一键冲突。
      for (const entry of result.entries) if (entry.id && entry.previousFilename !== entry.filename) {
        await connection.execute("UPDATE project_files SET filename = ? WHERE id = ?", [`issues/.task-set-${randomUUID()}.md`, entry.id]);
      }
      for (const entry of result.entries) {
        if (entry.change === "unchanged") continue;
        const fileId = entry.id ?? randomUUID();
        const contentChanged = entry.change === "content" || entry.change === "content-and-rename";
        const revision = entry.id ? entry.revision! + (contentChanged ? 1 : 0) : 1;
        if (entry.id) await connection.execute(
          "UPDATE project_files SET filename = ?, content = ?, previous_content = NULL, version = ?, updated_at = ? WHERE id = ?",
          [entry.filename, entry.content, revision, now, fileId],
        );
        else await connection.execute(
          `INSERT INTO project_files (id, project_id, filename, content, version, task_folder_id, issue_number, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [fileId, projectId, entry.filename, entry.content, folder.id, entry.number, now, now],
        );
        await record({ id: fileId, filename: entry.filename,
          previousFilename: entry.previousFilename !== entry.filename ? entry.previousFilename : null,
          action: !entry.id ? "create" : contentChanged ? "overwrite" : "rename",
          revision: !entry.id || contentChanged ? revision : null });
      }
    }
    await connection.execute("UPDATE iteration_task_set_candidates SET status = 'written', decided_at = ? WHERE id = ?", [now, candidate.id]);
    if (input.forceFailure) throw new Error("回放强制整套任务提交失败");
    await connection.commit();
    return { kind: "written" as const, folderId: folder.id, groupId: changed ? groupId : null };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
