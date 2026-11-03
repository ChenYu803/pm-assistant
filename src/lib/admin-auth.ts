import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { findMysqlUserById } from "@/lib/mysql-account-workspace";
import { isDesignatedAdmin } from "@/lib/account-controls";

/** 页面和每个管理接口独立调用，客户端提供的身份与角色一概不采信。 */
export async function requireAdmin(): Promise<string | NextResponse> {
  const userId = await requireAuth();
  if (userId instanceof NextResponse) return userId;
  const user = await findMysqlUserById(userId);
  if (!user || !isDesignatedAdmin(user.email)) return NextResponse.json({ error: "无权访问管理功能。" }, { status: 403 });
  return userId;
}
