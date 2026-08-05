import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * Authenticate the current request.
 * Returns the user ID string on success, or a 401 NextResponse on failure.
 * Callers should check `instanceof NextResponse` to distinguish.
 */
export async function requireAuth(): Promise<string | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  return session.user.id;
}
