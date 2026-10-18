import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createMysqlUser, findMysqlUserByEmail, normalizeEmail } from "@/lib/mysql-account-workspace";
import { mysqlUnavailableMessage } from "@/lib/mysql";
import { validRegistrationInvite } from "@/lib/launch-policy";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;
    if (!validRegistrationInvite(body.inviteCode)) return NextResponse.json({ error: "邀请码无效，请核对收到的邀请码。" }, { status: 403 });

    // Validate email format
    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "请输入邮箱地址" },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "邮箱格式不正确" },
        { status: 400 }
      );
    }

    // Validate password length
    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "密码长度至少为 6 位" },
        { status: 400 }
      );
    }

    const normalizedEmail = normalizeEmail(email);
    const existingUser = await findMysqlUserByEmail(normalizedEmail);
    if (existingUser) {
      return NextResponse.json(
        { error: "该邮箱已被注册" },
        { status: 409 }
      );
    }

    // Hash password and create user
    const password_hash = await bcrypt.hash(password, 12);
    const user = await createMysqlUser(normalizedEmail, password_hash);

    return NextResponse.json(
      { id: user.id, email: user.email },
      { status: 201 }
    );
  } catch (error) {
    console.error("Register error:", error);
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "该邮箱已被注册" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: mysqlUnavailableMessage() },
      { status: 500 }
    );
  }
}
