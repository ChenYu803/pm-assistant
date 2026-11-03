import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { GiftInviteError, voidGiftInvite } from "@/lib/gift-invites";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (actor instanceof NextResponse) return actor;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "reason") || typeof body.reason !== "string") throw new GiftInviteError("请填写作废原因。");
    return NextResponse.json(await voidGiftInvite(actor, (await params).id, body.reason));
  } catch (error) {
    if (error instanceof GiftInviteError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("邀请码作废失败（敏感细节已隐藏）");
    return NextResponse.json({ error: "作废操作失败，请稍后重试。" }, { status: 503 });
  }
}
