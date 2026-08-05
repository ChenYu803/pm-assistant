import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import dbConnect from "@/lib/mongodb";
import User from "@/models/User";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

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

    await dbConnect();

    // Mongoose schema handles lowercase + trim via schema options
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return NextResponse.json(
        { error: "该邮箱已被注册" },
        { status: 409 }
      );
    }

    // Hash password and create user
    const password_hash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email,
      password_hash,
    });

    return NextResponse.json(
      { id: user._id.toString(), email: user.email },
      { status: 201 }
    );
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json(
      { error: "注册失败，请稍后重试" },
      { status: 500 }
    );
  }
}
