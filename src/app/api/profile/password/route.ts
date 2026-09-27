import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { findMysqlUserById, updateMysqlPassword } from "@/lib/mysql-account-workspace";
import { mysqlUnavailableMessage } from "@/lib/mysql";

export async function POST(request: Request) {
  const userId = await requireAuth();
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const { currentPassword, newPassword, confirmPassword } = (body ?? {}) as Record<string, unknown>;
  if (typeof currentPassword !== "string" || !currentPassword) {
    return NextResponse.json({ error: "请输入当前密码" }, { status: 400 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    return NextResponse.json({ error: "密码长度至少为 6 位" }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "两次输入的新密码不一致" }, { status: 400 });
  }

  try {
    const user = await findMysqlUserById(userId);
    if (!user) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      return NextResponse.json({ error: "当前密码错误" }, { status: 400 });
    }
    const nextHash = await bcrypt.hash(newPassword, 12);
    if (!(await updateMysqlPassword(userId, user.password_hash, nextHash))) {
      return NextResponse.json({ error: "密码已更新，请重新尝试" }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/profile/password error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
