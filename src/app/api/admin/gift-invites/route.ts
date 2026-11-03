import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { GiftInviteError, listGiftInvites, seedInitialGiftInvites } from "@/lib/gift-invites";

export async function GET() {
  const actor = await requireAdmin();
  if (actor instanceof NextResponse) return actor;
  try { return NextResponse.json(await listGiftInvites(actor), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) {
    if (error instanceof GiftInviteError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("邀请码查询失败（敏感细节已隐藏）");
    return NextResponse.json({ error: "邀请码暂时无法查询。" }, { status: 503 });
  }
}
export async function POST(request: Request) {
  const actor = await requireAdmin();
  if (actor instanceof NextResponse) return actor;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "reason") || typeof body.reason !== "string") throw new GiftInviteError("请求格式不正确。");
    return NextResponse.json(await seedInitialGiftInvites(actor, body.reason), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof GiftInviteError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("首批邀请码初始化失败（敏感细节已隐藏）");
    return NextResponse.json({ error: "邀请码初始化失败，请确认是否已完成后再刷新查询。" }, { status: 503 });
  }
}
