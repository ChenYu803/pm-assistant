import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { MAX_FILE_BYTES } from "@/lib/file-helpers";
import { getMysqlPool } from "@/lib/mysql";

const HTML_BLOCK = /^%%%HTML_BEGIN%%%[ \t]*\r?\n([\s\S]*?)^%%%HTML_END%%%[ \t]*$/gm;

export function extractPrototypeHtml(answer: string) {
  const hasMarker = answer.includes("%%%HTML_BEGIN%%%") || answer.includes("%%%HTML_END%%%");
  if (!hasMarker) return { kind: "none" as const };
  const matches = [...answer.matchAll(HTML_BLOCK)];
  if (matches.length !== 1 || answer.split("%%%HTML_BEGIN%%%").length !== 2 || answer.split("%%%HTML_END%%%").length !== 2) {
    return { kind: "invalid" as const, error: "HTML 原型标记不完整，请重新生成。" };
  }
  const content = matches[0][1].trim();
  if (!/^\s*(?:<!doctype\s+html\s*>\s*)?<html(?:\s|>)/i.test(content) || !/<\/html>\s*$/i.test(content)) {
    return { kind: "invalid" as const, error: "HTML 原型不是完整页面，请重新生成。" };
  }
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    return { kind: "invalid" as const, error: "HTML 原型超过 3 MiB 上限，请让 Agent 精简后重试。" };
  }
  return { kind: "valid" as const, content };
}

export function withoutPrototypeHtml(answer: string) {
  return answer.replace(HTML_BLOCK, "").replace(/\n{3,}/g, "\n\n").trim();
}

export async function createIterationPrototypeSnapshot(connection: PoolConnection, input: {
  projectId: string; iterationId: string; sessionId: string; messageId: string; content: string;
}) {
  // 调用方已持有项目行锁，以序列化项目级快照版本号。
  const [versions] = await connection.query<Array<RowDataPacket & { version: number | null }>>(
    "SELECT MAX(version) AS version FROM prototype_snapshots WHERE project_id = ?", [input.projectId]);
  const version = Number(versions[0]?.version ?? 0) + 1;
  const id = randomUUID();
  await connection.execute<ResultSetHeader>(
    `INSERT INTO prototype_snapshots (id, project_id, content, version, iteration_id, session_id, message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.projectId, input.content, version, input.iterationId, input.sessionId, input.messageId]);
  return { id, version };
}

export type IterationPrototypeSnapshot = RowDataPacket & {
  id: string; version: number; iteration_id: string; session_id: string; message_id: string; created_at: Date;
};

export async function listIterationPrototypeSnapshots(projectId: string, iterationId: string) {
  const [rows] = await getMysqlPool().query<IterationPrototypeSnapshot[]>(
    `SELECT id, version, iteration_id, session_id, message_id, created_at
     FROM prototype_snapshots WHERE project_id = ? AND iteration_id = ? ORDER BY version DESC`,
    [projectId, iterationId]);
  return rows;
}
