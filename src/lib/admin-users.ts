import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getMysqlPool } from "@/lib/mysql";
import { creditText, creditUnits } from "@/lib/credit-values";
import { isMysqlId } from "@/lib/identifiers";
import { isDesignatedAdmin } from "@/lib/account-controls";

export class AdminUserError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function listAdminUsers(search: string, status: string, page: number) {
  const filters: string[] = []; const values: string[] = [];
  if (search) {
    // LIKE 的通配符显式转义，只进行字面账号查询。
    const literal = search.replace(/[!%_]/g, value => "!" + value);
    filters.push("(email LIKE ? ESCAPE '!' OR id = ?)"); values.push("%" + literal + "%", search);
  }
  if (status !== "all") { filters.push("account_status = ?"); values.push(status); }
  const where = filters.length ? " WHERE " + filters.join(" AND ") : "";
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [summary] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total, COALESCE(SUM(account_status = 'active'), 0) AS active, COALESCE(SUM(account_status = 'disabled'), 0) AS disabled FROM users");
    const [counts] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM users" + where, values);
    const total = Number(counts[0].total), pageSize = 20;
    const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const [rows] = await connection.query<RowDataPacket[]>("SELECT id, email, nickname, account_status AS status, created_at AS createdAt, disabled_at AS disabledAt, disabled_by AS disabledBy, disabled_reason AS disabledReason, COALESCE((SELECT SUM(available) FROM credit_sources WHERE user_id = users.id AND kind = 'gift'), 0) AS giftAvailable, COALESCE((SELECT SUM(available) FROM credit_sources WHERE user_id = users.id AND kind = 'purchased'), 0) AS purchasedAvailable FROM users" + where + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", [...values, pageSize, (currentPage - 1) * pageSize]);
    for (const row of rows) { row.giftAvailable = creditText(creditUnits(row.giftAvailable)); row.purchasedAvailable = creditText(creditUnits(row.purchasedAvailable)); }
    await connection.commit();
    return { users: rows, total, page: currentPage, pageSize, summary: { total: Number(summary[0].total), active: Number(summary[0].active), disabled: Number(summary[0].disabled) } };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function disableAdminUser(actorId: string, targetId: string, reason: string) {
  if (!isMysqlId(targetId)) throw new AdminUserError("账号不存在。", 404);
  if (actorId === targetId) throw new AdminUserError("不能停用当前管理员账号。", 409);
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    // 稳定顺序锁定操作者和目标，停用与审计同事务；同时拒绝已失效的管理身份。
    const [rows] = await connection.query<RowDataPacket[]>("SELECT id, email, account_status FROM users WHERE id IN (?, ?) ORDER BY id FOR UPDATE", [actorId, targetId]);
    const actor = rows.find(row => row.id === actorId), target = rows.find(row => row.id === targetId);
    if (!actor || actor.account_status !== "active" || !isDesignatedAdmin(actor.email)) throw new AdminUserError("无权访问管理功能。", 403);
    if (!target) throw new AdminUserError("账号不存在。", 404);
    if (target.account_status !== "disabled") {
      const now = new Date();
      await connection.execute("UPDATE users SET account_status = 'disabled', disabled_at = ?, disabled_by = ?, disabled_reason = ? WHERE id = ?", [now, actorId, reason, targetId]);
      await connection.execute("INSERT INTO account_admin_actions (id, actor_id, target_id, action, reason, created_at) VALUES (?, ?, ?, 'disable', ?, ?)", [randomUUID(), actorId, targetId, reason, now]);
    }
    await connection.commit();
    return { id: targetId, status: "disabled" as const };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
