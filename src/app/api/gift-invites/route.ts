import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { GiftInviteError, hasGiftRedemption, redeemGiftInvite } from "@/lib/gift-invites";
import { randomUUID } from "node:crypto";

export async function GET() {
  const userId = await requireAuth();
  if (userId instanceof NextResponse) return userId;
  return NextResponse.json(await hasGiftRedemption(userId), { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const userId = await requireAuth();
  if (userId instanceof NextResponse) return userId;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["code", "requestId"].includes(key))) throw new GiftInviteError("请求格式不正确。");
    const requestId = typeof body.requestId === "string" ? body.requestId : "invite-" + randomUUID();
    return NextResponse.json(await redeemGiftInvite(userId, body.code, requestId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof GiftInviteError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("邀请码兑换失败（敏感细节已隐藏）");
    return NextResponse.json({ error: "兑换暂时失败，请稍后使用相同邀请码重试。" }, { status: 503 });
  }
}
