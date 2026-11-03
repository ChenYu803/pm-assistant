import type { RowDataPacket } from "mysql2/promise";
import { getMysqlPool } from "@/lib/mysql";
import { isMysqlId } from "@/lib/identifiers";

export class AccountAccessError extends Error {}

/** 未配置时无人拥有管理权限；只匹配数据库中的规范化完整邮箱。 */
export function isDesignatedAdmin(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

export async function isAccountActive(userId: string): Promise<boolean> {
  if (!isMysqlId(userId)) return false;
  const [rows] = await getMysqlPool().query<RowDataPacket[]>("SELECT account_status FROM users WHERE id = ?", [userId]);
  return rows[0]?.account_status === "active";
}

/** 每次进入模型边界重新读取，不能信任 JWT 中的旧状态。 */
export async function assertAccountActive(userId: string | undefined) {
  if (!userId || !(await isAccountActive(userId))) throw new AccountAccessError("账号已停用或不可用，请联系运营者。");
}
