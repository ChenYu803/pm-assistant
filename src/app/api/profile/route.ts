import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { updateMysqlNickname } from "@/lib/mysql-account-workspace";
import { mysqlUnavailableMessage } from "@/lib/mysql";

export async function PATCH(request: Request) {
  const userId = await requireAuth();
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const nickname = (body as { nickname?: unknown } | null)?.nickname;
  if (typeof nickname !== "string" || !nickname.trim() || Array.from(nickname.trim()).length > 40) {
    return NextResponse.json({ error: "昵称应为 1 至 40 个字符" }, { status: 400 });
  }

  try {
    if (!(await updateMysqlNickname(userId, nickname.trim()))) {
      return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    }
    return NextResponse.json({ nickname: nickname.trim() });
  } catch (error) {
    console.error("PATCH /api/profile error:", error);
    return NextResponse.json({ error: mysqlUnavailableMessage() }, { status: 500 });
  }
}
