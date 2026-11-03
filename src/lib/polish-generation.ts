import { ModelStoppedError } from "@/lib/model-request-control";
import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { createAICompletion, isLiveAI } from "@/lib/ai";
import { CreditError, type CreditCallView } from "@/lib/credit-values";
import { findCreditCall } from "@/lib/conversation-credits";
import { lockCreditUsers } from "@/lib/credits-ledger";
import { completeModelProcessing, markModelProcessingFailure } from "@/lib/model-metering";
import { getMysqlPool } from "@/lib/mysql";
import type { MysqlProjectFile } from "@/lib/mysql-project-artifacts";
import type { PolishResult } from "@/lib/polish-result";

const POLISH_SYSTEM_PROMPT = `你是一个技术文档润色助手。请对以下 Markdown 内容进行润色：

1. 修正语法和拼写错误
2. 改善表达清晰度和专业性
3. 保持原有结构和信息不变
4. 不要添加新的内容或删除已有内容
5. 不要修改 Markdown 格式标记（标题、列表、代码块等）
6. 保留原有的变更日志头部（如果有的话）

请直接输出润色后的完整内容，不要添加任何解释或说明。`;

type Target = { userId: string; projectId: string; fileId: string };
type Operation = { status: number; body: PolishResult };

/** 只查询当前账号获授权文件的调用；结果与费用均来自持久事实。 */
export async function readPolishOperation(target: Target, requestId?: string): Promise<Operation | null> {
  const [rows] = await getMysqlPool().execute<RowDataPacket[]>(`SELECT c.request_key,m.status,m.error_code,r.content
    FROM conversation_credit_calls c JOIN model_requests m ON m.id=c.id
    LEFT JOIN polish_generation_results r ON r.call_id=c.id
    WHERE c.user_id=? AND m.purpose='polish' AND m.project_id=? AND m.file_id=?
    ${requestId ? "AND c.request_key=?" : ""} ORDER BY c.created_at DESC,c.id DESC LIMIT 1`,
  [target.userId,target.projectId,target.fileId,...(requestId ? [requestId] : [])]);
  if (!rows.length) return null;
  const row = rows[0], call = await findCreditCall(target.userId,row.request_key);
  if (!call) return null;
  const creditCall: CreditCallView = { id: call.id, messageId: call.messageId, state: call.state, reserved: call.reserved, consumed: call.consumed, reason: call.reason };
  const base = { requestId: row.request_key as string, creditCall };
  if (["running","processing"].includes(row.status)) return { status: 202, body: { ...base, state: "running" } };
  if (row.status === "stopped") return { status: 200, body: { ...base, state: "stopped", error: "润色已停止，请查看本次费用状态。" } };
  if (typeof row.content === "string") return { status: 200, body: { ...base, state: "completed", polished: row.content } };
  return { status: 500, body: { ...base, state: "failed", error: row.error_code === "polish_incomplete" ? "润色未生成完整正文，本次已免单，请重新尝试。" : "此润色未完成，请查看费用状态后重新尝试。" } };
}

export async function generatePolish(target: Target & { content: string; requestId: string; file: MysqlProjectFile; signal?: AbortSignal }): Promise<Operation> {
  const digest = createHash("sha256").update(JSON.stringify(["polish",target.projectId,target.fileId,target.content])).digest("hex");
  const replayExisting = async () => {
    const call = await findCreditCall(target.userId,target.requestId);
    if (!call) return null;
    if (call.requestDigest !== digest || call.sessionId !== target.fileId) throw new CreditError("此操作标识已用于其他内容，请恢复原请求或重新发起。",409);
    const operation = await readPolishOperation(target,target.requestId);
    if (!operation) throw new CreditError("此操作标识已用于其他生成。",409);
    return operation;
  };
  if (isLiveAI()) {
    const previous = await replayExisting();
    if (previous) return previous;
  }
  let modelRequestId: string | undefined;
  try {
    const polished = await createAICompletion({
      userId: target.userId, purpose: "polish", projectId: target.projectId, fileId: target.fileId,
      awaitProcessing: true,
      creditCall: { requestKey: target.requestId, requestDigest: digest, messageId: randomUUID(), sessionId: target.fileId,
        context: { purpose: "polish", projectId: target.projectId, fileId: target.fileId, filename: target.file.filename, fileRevision: Number(target.file.version) } },
      onRequest: id => { modelRequestId = id; },
      maxTokens: 32768,
      messages: [{ role: "system", content: POLISH_SYSTEM_PROMPT }, { role: "user", content: `请润色以下 Markdown 内容：\n\n${target.content}` }],
      timeoutMs: 600_000, signal: target.signal,
    });
    if (!modelRequestId) return { status: 200, body: { requestId: target.requestId, state: "completed", polished } };
    const connection = await getMysqlPool().getConnection();
    try {
      await connection.beginTransaction();
      await lockCreditUsers(connection,[target.userId]);
      // 正文持久化和正常结算共事务；不依赖用户应用、保存或继续打开弹窗。
      await connection.execute("INSERT INTO polish_generation_results (call_id,content,created_at) VALUES (?,?,?)",[modelRequestId,polished,new Date()]);
      await completeModelProcessing(modelRequestId,connection);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
    return (await readPolishOperation(target,target.requestId))!;
  } catch (error) {
    // commit 回执或随后查询可能失败；已持久完成的结果不可再补标为网站故障。
    if (modelRequestId) {
      const persisted = await readPolishOperation(target,target.requestId);
      if (persisted && persisted.body.state !== "running") return persisted;
      await markModelProcessingFailure(modelRequestId,error instanceof ModelStoppedError);
    }
    // 相同请求并发撞到唯一身份时，返回原调用状态，不再访问供应商。
    if (error instanceof CreditError && error.status === 409 && isLiveAI()) {
      const previous = await replayExisting();
      if (previous) return previous;
    }
    if (modelRequestId) {
      const failed = await readPolishOperation(target,target.requestId);
      if (failed) return failed;
    }
    throw error;
  }
}
