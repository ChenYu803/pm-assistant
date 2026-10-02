import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { validateFileSize } from "@/lib/file-helpers";
import { validCandidateFilename, type MarkdownCandidateStage } from "@/lib/markdown-candidate-filename";
import { getMysqlPool } from "@/lib/mysql";

const FILE_BLOCK = /^%%%FILE_BEGIN%%%[ \t]*([^\r\n]+)\r?\n([\s\S]*?)^%%%FILE_END%%%[ \t]*$/gm;
const PRD_CHAPTERS = ["概念", "Out of Scope", "页面清单", "实体级数据模型", "用户流程 + 验收标准", "文案基调"];

/** 只接受按顺序齐全且每章有正文的六章 PRD；候选不替 Agent 补写内容。 */
export function validPrdStructure(content: string) {
  const headings = [...content.matchAll(/^##[ \t]+(\d+)\.[ \t]+([^\r\n]+)[ \t]*$/gm)];
  if (headings.length !== PRD_CHAPTERS.length) return false;
  return headings.every((match, index) => {
    const next = headings[index + 1]?.index ?? content.length;
    const body = content.slice(match.index! + match[0].length, next).replace(/<!--[\s\S]*?-->/g, "");
    return Number(match[1]) === index + 1 && match[2].trim() === PRD_CHAPTERS[index]
      && body.split(/\r?\n/).some((line) => {
        const value = line.trim();
        return value.length > 0 && !/^#{1,6}\s/.test(value) && !/^[-*_]{3,}$/.test(value)
          && !/^\|?[\s|:-]+\|?$/.test(value);
      });
  });
}

export function extractMarkdownCandidate(answer: string, stage: MarkdownCandidateStage) {
  const matches = [...answer.matchAll(FILE_BLOCK)];
  const formal = matches.filter((match) => validCandidateFilename(match[1]?.trim(), stage));
  if (formal.length !== 1) return null;
  const match = formal[0];
  const content = match[2].replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  if (!content.trim() || !validateFileSize(content).ok || (stage === "prd" && !validPrdStructure(content))) return null;
  return { suggestedFilename: match[1].trim(), content };
}

export function withoutFileBlocks(answer: string) {
  return answer.replace(FILE_BLOCK, "").replace(/\n{3,}/g, "\n\n").trim();
}

export async function createMarkdownCandidate(connection: PoolConnection, input: { messageId: string; sessionId: string; answer: string; stage: MarkdownCandidateStage }) {
  const candidate = extractMarkdownCandidate(input.answer, input.stage);
  if (!candidate) return;
  await connection.execute<ResultSetHeader>(
    `INSERT INTO iteration_file_candidates (id, message_id, session_id, suggested_filename, content)
     VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), input.messageId, input.sessionId, candidate.suggestedFilename, candidate.content],
  );
}

type CandidateRow = RowDataPacket & {
  id: string; message_id: string; suggested_filename: string; content: string;
  status: "pending" | "discarded" | "written"; final_filename: string | null;
};

export async function listMarkdownCandidates(sessionId: string) {
  const [rows] = await getMysqlPool().query<CandidateRow[]>(
    "SELECT id, message_id, suggested_filename, content, status, final_filename FROM iteration_file_candidates WHERE session_id = ?",
    [sessionId],
  );
  return new Map(rows.map((row) => [row.message_id, {
    id: row.id, suggestedFilename: row.suggested_filename, content: row.content,
    status: row.status, finalFilename: row.final_filename,
  }]));
}

export async function decideMarkdownCandidate(input: {
  iterationId: string; sessionId: string; candidateId: string; userId: string;
  action: "discard" | "write"; filename?: string; expectedOperation?: "create" | "overwrite";
  forceFailure?: boolean;
}) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    // 与删除迭代保持项目 → 迭代的锁顺序，避免并发确认与删除互等。
    const [projectLookup] = await connection.query<Array<RowDataPacket & { project_id: string }>>(
      "SELECT project_id FROM product_iterations WHERE id = ? LIMIT 1", [input.iterationId],
    );
    const projectId = projectLookup[0]?.project_id;
    if (!projectId) { await connection.rollback(); return { kind: "not-found" as const }; }
    const [projects] = await connection.query<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM projects WHERE id = ? AND user_id = ? FOR UPDATE", [projectId, input.userId],
    );
    if (!projects.length) { await connection.rollback(); return { kind: "not-found" as const }; }
    const [iterations] = await connection.query<Array<RowDataPacket & {
      project_id: string; iteration_number: number; display_name: string;
    }>>(
      `SELECT project_id, iteration_number, display_name FROM product_iterations
       WHERE id = ? AND project_id = ? FOR UPDATE`, [input.iterationId, projectId],
    );
    const iteration = iterations[0];
    if (!iteration) { await connection.rollback(); return { kind: "not-found" as const }; }
    const [rows] = await connection.query<Array<CandidateRow & { session_name: string; stage: string }>>(
      `SELECT c.id, c.message_id, c.suggested_filename, c.content, c.status, c.final_filename,
              s.title AS session_name, s.stage
       FROM iteration_file_candidates c JOIN iteration_sessions s ON s.id = c.session_id
       WHERE c.id = ? AND c.session_id = ? AND s.iteration_id = ? FOR UPDATE`,
      [input.candidateId, input.sessionId, input.iterationId],
    );
    const candidate = rows[0];
    const stage: MarkdownCandidateStage | null = candidate?.stage === "requirements" ? "analysis" : candidate?.stage === "prototype" ? "prototype" : candidate?.stage === "prd" ? "prd" : null;
    if (!candidate || !stage) { await connection.rollback(); return { kind: "not-found" as const }; }
    if (candidate.status !== "pending") { await connection.rollback(); return { kind: "decided" as const }; }
    if (input.action === "discard") {
      await connection.execute<ResultSetHeader>(
        "UPDATE iteration_file_candidates SET status = 'discarded', decided_at = ? WHERE id = ?",
        [new Date(), candidate.id],
      );
      await connection.commit();
      return { kind: "discarded" as const };
    }
    if (!validCandidateFilename(input.filename, stage)) { await connection.rollback(); return { kind: "invalid-filename" as const, stage }; }
    if (stage === "prd" && !validPrdStructure(candidate.content)) { await connection.rollback(); return { kind: "invalid-structure" as const }; }
    const size = validateFileSize(candidate.content);
    if (!size.ok) { await connection.rollback(); return { kind: "too-large" as const }; }
    const [existingRows] = await connection.query<Array<RowDataPacket & {
      id: string; content: string; version: number; freeze_binding_tab_id: string | null;
    }>>(
      "SELECT id, content, version, freeze_binding_tab_id FROM project_files WHERE project_id = ? AND BINARY filename = BINARY ? FOR UPDATE",
      [iteration.project_id, input.filename],
    );
    const existing = existingRows[0];
    const operation = existing ? "overwrite" : "create";
    if (operation !== input.expectedOperation) { await connection.rollback(); return { kind: "operation-changed" as const, operation }; }
    if (existing?.freeze_binding_tab_id) { await connection.rollback(); return { kind: "locked" as const }; }
    const fileId = existing?.id ?? randomUUID();
    const revision = existing ? Number(existing.version) + 1 : 1;
    const now = new Date();
    if (existing) {
      await connection.execute<ResultSetHeader>(
        `UPDATE project_files SET previous_content = content, content = ?, version = ?, updated_at = ? WHERE id = ?`,
        [candidate.content, revision, now, fileId],
      );
    } else {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO project_files (id, project_id, filename, content, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [fileId, iteration.project_id, input.filename, candidate.content, now, now],
      );
    }
    await connection.execute<ResultSetHeader>(
      `INSERT INTO project_file_changes
       (id, project_id, file_id, operation, filename, content_revision, actor, iteration_id,
        iteration_number, iteration_name, stage, session_id, session_name, message_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 'agent', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), iteration.project_id, fileId, operation, input.filename, revision,
        input.iterationId, iteration.iteration_number, iteration.display_name, stage,
        input.sessionId, candidate.session_name, candidate.message_id, now],
    );
    await connection.execute<ResultSetHeader>(
      "UPDATE iteration_file_candidates SET status = 'written', final_filename = ?, decided_at = ? WHERE id = ?",
      [input.filename, now, candidate.id],
    );
    if (input.forceFailure) throw new Error("回放强制候选写入失败");
    await connection.commit();
    return { kind: "written" as const, operation, fileId, filename: input.filename, revision };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
