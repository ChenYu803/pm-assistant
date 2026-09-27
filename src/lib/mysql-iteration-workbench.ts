import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { AGENT_SYSTEM_PROMPTS } from "@/lib/agent-prompts";
import { createAIStream, isAIConfigured, type AIMessage } from "@/lib/ai";
import type { AgentType } from "@/lib/agent-constants";
import { isConceptDocFile, isWorkingDocFile, stripChangelogHeader } from "@/lib/file-helpers";
import { getMysqlPool } from "@/lib/mysql";
import { cancelGeneration, registerGeneration, releaseGeneration } from "@/lib/generation-control";
import { formatWorkbenchContextPrompt, type WorkbenchDirectoryFile } from "@/lib/workbench-context-prompt";

export const WORKBENCH_STAGES = ["analysis", "prototype", "prd", "tickets"] as const;
export type WorkbenchStage = (typeof WORKBENCH_STAGES)[number];
export type WorkbenchStageStatus = "not_started" | "in_progress" | "completed";
export const WORKBENCH_STAGE_LABELS: Record<WorkbenchStage, string> = {
  analysis: "需求分析",
  prototype: "原型设计",
  prd: "PRD",
  tickets: "任务拆分",
};
const STAGE_AGENT: Record<WorkbenchStage, AgentType> = {
  analysis: "requirement_analyst",
  prototype: "prototype",
  prd: "mvp_prd",
  tickets: "ticket_splitter",
};
const stageToStorage = (stage: WorkbenchStage) => stage === "analysis" ? "requirements" : stage === "tickets" ? "tasks" : stage;
const stageFromStorage = (stage: string): WorkbenchStage => stage === "requirements" ? "analysis" : stage === "tasks" ? "tickets" : stage as WorkbenchStage;

type OwnedIteration = RowDataPacket & {
  id: string; project_id: string; iteration_number: number; display_name: string;
  goal: string | null; current_stage: WorkbenchStage; created_at: Date; updated_at: Date;
  project_name: string;
};
type SessionRow = RowDataPacket & {
  id: string; iteration_id: string; stage: WorkbenchStage; title: string;
  created_at: Date; updated_at: Date;
};

export async function findOwnedWorkbenchIteration(iterationId: string, userId: string) {
  const [rows] = await getMysqlPool().query<OwnedIteration[]>(
    `SELECT i.id, i.project_id, i.iteration_number, i.display_name, i.goal, i.current_stage, i.created_at, i.updated_at,
            p.name AS project_name
     FROM product_iterations i JOIN projects p ON p.id = i.project_id
     WHERE i.id = ? AND p.user_id = ? LIMIT 1`, [iterationId, userId]);
  return rows[0] ?? null;
}

async function lockOwnedIteration(connection: PoolConnection, iterationId: string, userId: string) {
  const [rows] = await connection.query<Array<RowDataPacket & { id: string }>>(
    `SELECT i.id FROM product_iterations i JOIN projects p ON p.id = i.project_id
     WHERE i.id = ? AND p.user_id = ? FOR UPDATE`, [iterationId, userId]);
  return rows.length > 0;
}

export async function getMysqlIterationWorkbench(iterationId: string, userId: string) {
  const iteration = await findOwnedWorkbenchIteration(iterationId, userId);
  if (!iteration) return null;
  const [states] = await getMysqlPool().query<Array<RowDataPacket & { stage: WorkbenchStage; status: string }>>(
    "SELECT stage, status FROM iteration_stage_states WHERE iteration_id = ?", [iterationId]);
  const [sessions] = await getMysqlPool().query<SessionRow[]>(
    "SELECT id, iteration_id, stage, title, created_at, updated_at FROM iteration_sessions WHERE iteration_id = ? ORDER BY updated_at DESC, id DESC", [iterationId]);
  const [generating] = await getMysqlPool().query<Array<RowDataPacket & { session_id: string; stage: WorkbenchStage }>>(
    `SELECT DISTINCT m.session_id, s.stage FROM iteration_session_messages m
     JOIN iteration_sessions s ON s.id = m.session_id
     WHERE s.iteration_id = ? AND m.status = 'generating'`, [iterationId]);
  const statusMap = new Map(states.map((row) => [stageFromStorage(row.stage), row.status]));
  const sessionMap = new Map<WorkbenchStage, SessionRow[]>();
  for (const session of sessions) {
    const stage = stageFromStorage(session.stage);
    sessionMap.set(stage, [...(sessionMap.get(stage) ?? []), { ...session, stage }]);
  }
  return {
    project: { id: iteration.project_id, name: iteration.project_name },
    iteration: {
      id: iteration.id, project_id: iteration.project_id, iteration_number: Number(iteration.iteration_number),
      display_name: iteration.display_name, goal: iteration.goal, created_at: iteration.created_at, updated_at: iteration.updated_at,
    },
    currentStage: stageFromStorage(iteration.current_stage),
    stages: WORKBENCH_STAGES.map((key) => ({
      key, label: WORKBENCH_STAGE_LABELS[key], status: statusMap.get(key) ?? "not_started",
      generatingSessionIds: generating.filter((row) => stageFromStorage(row.stage) === key).map((row) => row.session_id),
      sessions: (sessionMap.get(key) ?? []).map((session) => ({
        id: session.id, title: session.title, updatedAt: session.updated_at,
      })),
    })),
  };
}

export async function setMysqlIterationCurrentStage(iterationId: string, userId: string, stage: WorkbenchStage, sessionId?: string) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    if (!(await lockOwnedIteration(connection, iterationId, userId))) { await connection.rollback(); return null; }
    if (sessionId) {
      const [sessions] = await connection.query<Array<RowDataPacket & { id: string }>>(
        "SELECT id FROM iteration_sessions WHERE id = ? AND iteration_id = ? AND stage = ?", [sessionId, iterationId, stageToStorage(stage)]);
      if (!sessions.length) { await connection.rollback(); return null; }
      await connection.execute<ResultSetHeader>(
        `INSERT INTO iteration_stage_states (iteration_id, stage, status) VALUES (?, ?, 'in_progress')
         ON DUPLICATE KEY UPDATE status = 'in_progress'`, [iterationId, stageToStorage(stage)]);
    }
    await connection.execute<ResultSetHeader>("UPDATE product_iterations SET current_stage = ? WHERE id = ?", [stageToStorage(stage), iterationId]);
    await connection.commit();
    return { currentStage: stage, ...(sessionId ? { status: "in_progress" as const } : {}) };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function completeMysqlIterationStage(iterationId: string, userId: string, stage: WorkbenchStage) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    if (!(await lockOwnedIteration(connection, iterationId, userId))) { await connection.rollback(); return "not-found" as const; }
    const [states] = await connection.query<Array<RowDataPacket & { status: WorkbenchStageStatus }>>(
      "SELECT status FROM iteration_stage_states WHERE iteration_id = ? AND stage = ?", [iterationId, stageToStorage(stage)]);
    if (states[0]?.status !== "in_progress") { await connection.rollback(); return "not-in-progress" as const; }
    const [pending] = await connection.query<Array<RowDataPacket & { id: string }>>(
      `SELECT m.id FROM iteration_session_messages m JOIN iteration_sessions s ON s.id = m.session_id
       WHERE s.iteration_id = ? AND s.stage = ? AND m.status = 'generating' LIMIT 1`, [iterationId, stageToStorage(stage)]);
    if (pending.length) { await connection.rollback(); return "generating" as const; }
    await connection.execute<ResultSetHeader>(
      "UPDATE iteration_stage_states SET status = 'completed' WHERE iteration_id = ? AND stage = ?", [iterationId, stageToStorage(stage)]);
    await connection.commit();
    return "completed" as const;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function createMysqlIterationSession(iterationId: string, userId: string, stage: WorkbenchStage) {
  const id = randomUUID();
  const now = new Date();
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    if (!(await lockOwnedIteration(connection, iterationId, userId))) { await connection.rollback(); return null; }
    await connection.execute<ResultSetHeader>(
      "INSERT INTO iteration_sessions (id, iteration_id, stage, title, created_at, updated_at) VALUES (?, ?, ?, '新会话', ?, ?)", [id, iterationId, stageToStorage(stage), now, now]);
    await connection.execute<ResultSetHeader>(
      `INSERT INTO iteration_stage_states (iteration_id, stage, status, updated_at) VALUES (?, ?, 'in_progress', ?)
       ON DUPLICATE KEY UPDATE status = 'in_progress', updated_at = VALUES(updated_at)`, [iterationId, stageToStorage(stage), now]);
    await connection.execute<ResultSetHeader>("UPDATE product_iterations SET current_stage = ? WHERE id = ?", [stageToStorage(stage), iterationId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  return { id, iteration_id: iterationId, stage, title: "新会话", created_at: now, updated_at: now };
}

export async function findOwnedIterationSession(iterationId: string, sessionId: string, userId: string) {
  const [rows] = await getMysqlPool().query<Array<SessionRow & RowDataPacket & { project_id: string }>>(
    `SELECT s.id, s.iteration_id, s.stage, s.title, s.created_at, s.updated_at, i.project_id
     FROM iteration_sessions s JOIN product_iterations i ON i.id = s.iteration_id
     JOIN projects p ON p.id = i.project_id
     WHERE s.id = ? AND i.id = ? AND p.user_id = ? LIMIT 1`, [sessionId, iterationId, userId]);
  return rows[0] ? { ...rows[0], stage: stageFromStorage(rows[0].stage) } : null;
}

export async function deleteMysqlIterationSession(iterationId: string, sessionId: string, userId: string) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [sessions] = await connection.query<Array<SessionRow & RowDataPacket>>(
      `SELECT s.id, s.iteration_id, s.stage, s.title, s.created_at, s.updated_at
       FROM iteration_sessions s JOIN product_iterations i ON i.id = s.iteration_id
       JOIN projects p ON p.id = i.project_id
       WHERE s.id = ? AND i.id = ? AND p.user_id = ? FOR UPDATE`, [sessionId, iterationId, userId]);
    if (!sessions.length) { await connection.rollback(); return "not-found" as const; }
    const [pending] = await connection.query<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM iteration_session_messages WHERE session_id = ? AND status = 'generating' LIMIT 1", [sessionId]);
    if (pending.length) { await connection.rollback(); return "generating" as const; }
    await connection.execute<ResultSetHeader>("DELETE FROM iteration_sessions WHERE id = ? AND iteration_id = ?", [sessionId, iterationId]);
    await connection.commit();
    return "deleted" as const;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function listMysqlIterationMessages(sessionId: string) {
  const [rows] = await getMysqlPool().query<Array<RowDataPacket & { id: string; role: "user" | "assistant"; content: string; status: string; error_message: string | null; created_at: Date }>>(
    "SELECT id, role, content, status, error_message, created_at FROM iteration_session_messages WHERE session_id = ? ORDER BY created_at ASC, role ASC, id ASC", [sessionId]);
  return rows.map((row) => ({ id: row.id, role: row.role, content: row.content, status: row.status, errorMessage: row.error_message, createdAt: row.created_at }));
}

export async function stopMysqlIterationGeneration(iterationId: string, sessionId: string, userId: string) {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    if (!(await lockOwnedIteration(connection, iterationId, userId))) { await connection.rollback(); return "not-found" as const; }
    const [sessions] = await connection.query<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM iteration_sessions WHERE id = ? AND iteration_id = ?", [sessionId, iterationId]);
    if (!sessions.length) { await connection.rollback(); return "not-found" as const; }
    const [pending] = await connection.query<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM iteration_session_messages WHERE session_id = ? AND status = 'generating' LIMIT 1", [sessionId]);
    if (!pending.length) { await connection.rollback(); return "not-generating" as const; }
    await connection.execute<ResultSetHeader>(
      "UPDATE iteration_session_messages SET status = 'failed', error_message = '生成已停止' WHERE id = ? AND status = 'generating'", [pending[0].id]);
    await connection.commit();
    cancelGeneration(pending[0].id);
    return "stopped" as const;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

function sameMessageSnapshot(left: Awaited<ReturnType<typeof listMysqlIterationMessages>>, right: Awaited<ReturnType<typeof listMysqlIterationMessages>>) {
  return left.length === right.length && left.every((message, index) => {
    const other = right[index];
    return other && message.id === other.id && message.role === other.role && message.status === other.status && message.content === other.content && message.createdAt.valueOf() === other.createdAt.valueOf();
  });
}

async function contextFiles(sessionId: string, projectId: string) {
  const [rows] = await getMysqlPool().query<Array<RowDataPacket & { id: string; filename: string; content: string; version: number; updated_at: Date; loaded_at: Date }>>(
    `SELECT f.id, f.filename, f.content, f.version, f.updated_at, c.loaded_at
     FROM iteration_session_context_files c JOIN project_files f ON f.id = c.file_id
     WHERE c.session_id = ? AND f.project_id = ? ORDER BY c.loaded_at ASC, f.id ASC`, [sessionId, projectId]);
  return rows.filter((file) => !isWorkingDocFile(file.filename) && !isConceptDocFile(file.filename));
}

export async function listMysqlIterationContext(iterationId: string, sessionId: string, userId: string) {
  const session = await findOwnedIterationSession(iterationId, sessionId, userId);
  if (!session) return null;
  const files = await contextFiles(sessionId, session.project_id);
  return files.map(({ id, filename, version, updated_at, loaded_at }) => ({ id, filename, version: Number(version), updatedAt: updated_at, loadedAt: loaded_at }));
}

export async function mutateMysqlIterationContext(iterationId: string, sessionId: string, fileId: string, userId: string, action: "add" | "remove") {
  const session = await findOwnedIterationSession(iterationId, sessionId, userId);
  if (!session) return { kind: "session-not-found" as const };
  const [files] = await getMysqlPool().query<Array<RowDataPacket & { id: string; filename: string; version: number; updated_at: Date }>>(
    "SELECT id, filename, version, updated_at FROM project_files WHERE id = ? AND project_id = ? LIMIT 1", [fileId, session.project_id]);
  const file = files[0];
  if (!file) return { kind: "file-not-found" as const };
  if (isWorkingDocFile(file.filename) || isConceptDocFile(file.filename)) return { kind: "not-loadable" as const };
  if (action === "add") {
    try {
      await getMysqlPool().execute<ResultSetHeader>("INSERT INTO iteration_session_context_files (session_id, file_id, loaded_at) VALUES (?, ?, ?)", [sessionId, fileId, new Date()]);
    } catch (error) { if ((error as { code?: string }).code === "ER_DUP_ENTRY") return { kind: "duplicate" as const }; throw error; }
  } else {
    const [result] = await getMysqlPool().execute<ResultSetHeader>("DELETE FROM iteration_session_context_files WHERE session_id = ? AND file_id = ?", [sessionId, fileId]);
    if (result.affectedRows !== 1) return { kind: "not-loaded" as const };
  }
  return { kind: action === "add" ? "added" as const : "removed" as const, file: { id: file.id, filename: file.filename, version: Number(file.version), updatedAt: file.updated_at } };
}

export async function buildMysqlIterationPrompt(iterationId: string, sessionId: string, userId: string, stage: WorkbenchStage) {
  const iteration = await findOwnedWorkbenchIteration(iterationId, userId);
  if (!iteration) return null;
  // 单条 SQL 的快照同时决定目录元数据、已加载引用和正文，未加载文件不会返回正文。
  const [rows] = await getMysqlPool().query<Array<RowDataPacket & { filename: string; version: number; content: string | null }>>(
    `SELECT f.filename, f.version,
            CASE WHEN c.file_id IS NOT NULL THEN f.content ELSE NULL END AS content
     FROM project_files f
     LEFT JOIN iteration_session_context_files c ON c.file_id = f.id AND c.session_id = ?
     WHERE f.project_id = ? ORDER BY f.filename ASC`, [sessionId, iteration.project_id]);
  const files: WorkbenchDirectoryFile[] = rows
    .filter((file) => !isWorkingDocFile(file.filename) && !isConceptDocFile(file.filename))
    .map((file) => ({
      filename: file.filename, version: Number(file.version),
      content: file.content === null ? null : stripChangelogHeader(file.content),
      lastContentIteration: null, canUndo: false,
    }));
  return {
    prompt: `${AGENT_SYSTEM_PROMPTS[STAGE_AGENT[stage]]}\n\n## v1.41 当前会话边界（与上文旧流程假设冲突时，以本节为准）\n${formatWorkbenchContextPrompt({
      projectName: iteration.project_name, iterationName: iteration.display_name,
      iterationNumber: Number(iteration.iteration_number), stage, stageLabels: WORKBENCH_STAGE_LABELS,
      goal: iteration.goal, files,
    })}`,
    agentType: STAGE_AGENT[stage],
  };
}

export async function generateMysqlIterationMessage(input: {
  iterationId: string; sessionId: string; userId: string; content?: string; regenerateMessageId?: string; editMessageId?: string; replayDelayMs?: number;
}) {
  const session = await findOwnedIterationSession(input.iterationId, input.sessionId, input.userId);
  if (!session) return { kind: "not-found" as const };
  if (!isAIConfigured()) return { kind: "not-configured" as const };
  const pool = getMysqlPool();
  const allMessages = await listMysqlIterationMessages(input.sessionId);
  if (allMessages.some((message) => message.status === "generating")) return { kind: "generating" as const };
  let history: AIMessage[] = allMessages.filter((message) => message.status === "completed").map((message) => ({ role: message.role, content: message.content } as AIMessage));
  let userMessage: { id: string; role: "user"; content: string; createdAt: Date } | null = null;
  let editTarget: (typeof allMessages)[number] | null = null;
  let regenerateTarget: (typeof allMessages)[number] | null = null;
  if (input.regenerateMessageId) {
    const index = allMessages.findIndex((message) => message.id === input.regenerateMessageId);
    const target = allMessages[index];
    if (!target || target.role !== "assistant" || target.status !== "completed" || allMessages.slice(index + 1).some((message) => message.status === "completed")) return { kind: "invalid-regenerate" as const };
    regenerateTarget = target;
    history = allMessages.slice(0, index).filter((message) => message.status === "completed").map((message) => ({ role: message.role, content: message.content } as AIMessage));
  } else if (input.editMessageId) {
    const index = allMessages.findIndex((message) => message.id === input.editMessageId);
    const target = allMessages[index];
    if (!target || target.role !== "user" || typeof input.content !== "string" || !input.content.trim() || allMessages.slice(index + 1).some((message) => message.role === "user")) return { kind: "invalid-edit" as const };
    const content = input.content.trim();
    editTarget = target;
    userMessage = { id: target.id, role: "user", content, createdAt: target.createdAt };
    history = allMessages.slice(0, index).filter((message) => message.status === "completed").map((message) => ({ role: message.role, content: message.content } as AIMessage));
  } else {
    if (!input.content?.trim()) return { kind: "empty" as const };
    const now = new Date();
    const id = randomUUID();
    userMessage = { id, role: "user", content: input.content.trim(), createdAt: now };
  }
  const prompt = await buildMysqlIterationPrompt(input.iterationId, input.sessionId, input.userId, session.stage);
  if (!prompt) return { kind: "not-found" as const };
  if (userMessage && !input.regenerateMessageId) history.push({ role: "user", content: userMessage.content });
  const assistantId = randomUUID();
  let createdAt = new Date();
  const reservation = await pool.getConnection();
  try {
    await reservation.beginTransaction();
    const [iterationRows] = await reservation.query<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM product_iterations WHERE id = ? FOR UPDATE", [input.iterationId]);
    if (!iterationRows.length) { await reservation.rollback(); return { kind: "not-found" as const }; }
    const [stageRows] = await reservation.query<Array<RowDataPacket & { status: WorkbenchStageStatus }>>(
      "SELECT status FROM iteration_stage_states WHERE iteration_id = ? AND stage = ?", [input.iterationId, stageToStorage(session.stage)]);
    if (stageRows[0]?.status === "completed") { await reservation.rollback(); return { kind: "stage-completed" as const }; }
    const [locked] = await reservation.query<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM iteration_sessions WHERE id = ? AND iteration_id = ? FOR UPDATE", [input.sessionId, input.iterationId]);
    if (!locked.length) { await reservation.rollback(); return { kind: "not-found" as const }; }
    const [pending] = await reservation.query<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM iteration_session_messages WHERE session_id = ? AND status = 'generating' LIMIT 1", [input.sessionId]);
    if (pending.length) { await reservation.rollback(); return { kind: "generating" as const }; }
    const [freshRows] = await reservation.query<Array<RowDataPacket & { id: string; role: "user" | "assistant"; content: string; status: string; error_message: string | null; created_at: Date }>>(
      "SELECT id, role, content, status, error_message, created_at FROM iteration_session_messages WHERE session_id = ? ORDER BY created_at ASC, role ASC, id ASC", [input.sessionId]);
    const freshMessages = freshRows.map((row) => ({ id: row.id, role: row.role, content: row.content, status: row.status, errorMessage: row.error_message, createdAt: row.created_at }));
    if (!sameMessageSnapshot(allMessages, freshMessages)) {
      await reservation.rollback();
      return { kind: "conflict" as const };
    }
    // DATETIME(3) 同毫秒写入会按随机 UUID 乱序，因此在会话锁内顺延时间戳。
    const latestCreatedAt = freshMessages.reduce((latest, message) => Math.max(latest, message.createdAt.valueOf()), 0);
    if (userMessage && !input.regenerateMessageId && !input.editMessageId) {
      userMessage.createdAt = new Date(Math.max(userMessage.createdAt.valueOf(), latestCreatedAt + 1));
      createdAt = new Date(Math.max(createdAt.valueOf(), userMessage.createdAt.valueOf() + 1));
      await reservation.execute<ResultSetHeader>("INSERT INTO iteration_session_messages (id, session_id, role, content, status, created_at) VALUES (?, ?, 'user', ?, 'completed', ?)", [userMessage.id, input.sessionId, userMessage.content, userMessage.createdAt]);
      await reservation.execute<ResultSetHeader>("UPDATE iteration_sessions SET title = IF(title = '新会话', ?, title), updated_at = ? WHERE id = ?", [userMessage.content.slice(0, 80), new Date(), input.sessionId]);
    } else createdAt = new Date(Math.max(createdAt.valueOf(), latestCreatedAt + 1));
    await reservation.execute<ResultSetHeader>("INSERT INTO iteration_session_messages (id, session_id, role, content, status, created_at) VALUES (?, ?, 'assistant', '', 'generating', ?)", [assistantId, input.sessionId, createdAt]);
    await reservation.commit();
  } catch (error) { await reservation.rollback(); throw error; } finally { reservation.release(); }
  const generation = registerGeneration(assistantId);
  async function stoppedResult() {
    if (editTarget || regenerateTarget) {
      await pool.execute<ResultSetHeader>(
        "DELETE FROM iteration_session_messages WHERE id = ? AND session_id = ? AND status = 'failed' AND error_message = '生成已停止'",
        [assistantId, input.sessionId]);
    }
    return { kind: "generation-stopped" as const };
  }
  try {
    const [active] = await pool.query<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM iteration_session_messages WHERE id = ? AND status = 'generating'", [assistantId]);
    if (!active.length || generation.signal.aborted) return stoppedResult();
    const stream = await createAIStream({ agentType: prompt.agentType, maxTokens: 32768, messages: [{ role: "system", content: prompt.prompt }, ...history], timeoutMs: 600_000, signal: generation.signal, replayDelayMs: input.replayDelayMs });
    let answer = "";
    for await (const chunk of stream) {
      if (generation.signal.aborted) throw new Error("生成已停止");
      answer += chunk.choices[0]?.delta?.content ?? "";
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("SELECT id FROM product_iterations WHERE id = ? FOR UPDATE", [input.iterationId]);
      const [activeRows] = await connection.query<Array<RowDataPacket & { id: string }>>(
        "SELECT id FROM iteration_session_messages WHERE id = ? AND session_id = ? AND status = 'generating'", [assistantId, input.sessionId]);
      if (!activeRows.length || generation.signal.aborted) {
        await connection.rollback();
        return stoppedResult();
      }
      if (editTarget) {
        await connection.execute<ResultSetHeader>("UPDATE iteration_session_messages SET content = ? WHERE id = ? AND session_id = ? AND role = 'user'", [userMessage!.content, editTarget.id, input.sessionId]);
        await connection.execute<ResultSetHeader>("DELETE FROM iteration_session_messages WHERE session_id = ? AND id <> ? AND (created_at > ? OR (created_at = ? AND (role = 'assistant' OR id > ?)))", [input.sessionId, assistantId, new Date(editTarget.createdAt), new Date(editTarget.createdAt), editTarget.id]);
      } else if (regenerateTarget) {
        await connection.execute<ResultSetHeader>("DELETE FROM iteration_session_messages WHERE session_id = ? AND id <> ? AND (created_at > ? OR (created_at = ? AND role = 'assistant' AND id >= ?))", [input.sessionId, assistantId, new Date(regenerateTarget.createdAt), new Date(regenerateTarget.createdAt), regenerateTarget.id]);
      }
      await connection.execute<ResultSetHeader>("UPDATE iteration_session_messages SET content = ?, status = 'completed', error_message = NULL WHERE id = ? AND session_id = ?", [answer, assistantId, input.sessionId]);
      const title = userMessage?.content.slice(0, 80) || "新会话";
      await connection.execute<ResultSetHeader>("UPDATE iteration_sessions SET title = IF(title = '新会话', ?, title), updated_at = ? WHERE id = ?", [title, new Date(), input.sessionId]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return { kind: "generated" as const, userMessage, assistantMessage: { id: assistantId, role: "assistant" as const, content: answer, status: "completed", errorMessage: null, createdAt } };
  } catch (error) {
    const stopped = generation.signal.aborted;
    const message = stopped ? "生成已停止" : error instanceof Error ? error.message : "Agent 生成失败";
    if (!editTarget && !regenerateTarget) {
      await pool.execute<ResultSetHeader>("UPDATE iteration_session_messages SET status = 'failed', error_message = ? WHERE id = ? AND session_id = ? AND status = 'generating'", [message, assistantId, input.sessionId]);
      await pool.execute<ResultSetHeader>("UPDATE iteration_sessions SET updated_at = ? WHERE id = ?", [new Date(), input.sessionId]);
    } else if (!stopped) await pool.execute<ResultSetHeader>("DELETE FROM iteration_session_messages WHERE id = ? AND session_id = ? AND status = 'generating'", [assistantId, input.sessionId]);
    return stopped ? stoppedResult() : { kind: "generation-failed" as const, error: message, userMessage, assistantMessageId: assistantId };
  } finally {
    releaseGeneration(assistantId, generation);
  }
}
