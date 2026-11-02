import type { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { withoutSessionRenewal } from "@/lib/auth-session-cookies";

// 会话读取和客户端 session 更新均不续期；登录/退出路由仍正常签发或清除。
export async function GET(request: NextRequest) {
  const response = await handlers.GET(request);
  return request.nextUrl.pathname === "/api/auth/session" ? withoutSessionRenewal(response) : response;
}

export async function POST(request: NextRequest) {
  const response = await handlers.POST(request);
  return request.nextUrl.pathname === "/api/auth/session" ? withoutSessionRenewal(response) : response;
}
