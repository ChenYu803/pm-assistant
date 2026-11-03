import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { withoutSessionRenewal } from "@/lib/auth-session-cookies";

const authenticate = auth((_request: NextRequest, _event: NextFetchEvent) => undefined);

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  const response = await authenticate(request, event);
  const safeResponse = response ? withoutSessionRenewal(response) : NextResponse.next();
  if (request.nextUrl.pathname === "/admin/model-requests") safeResponse.headers.set("Cache-Control", "private, no-store");
  return safeResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - api/auth 及其子路径：认证路由自行管理 Cookie，避免代理续期覆盖退出清除。
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public directory)
     */
    "/((?!api/auth(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
