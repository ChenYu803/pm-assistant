import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminUserError, disableAdminUser } from "@/lib/admin-users";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin();
    if (actor instanceof NextResponse) return actor;
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(process.env.AUTH_URL || request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site" || !request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "不允许此请求。" }, { status: 403 });
    // 流式限长，不能让管理接口读入无限请求正文。
    const reader = request.body?.getReader();
    if (!reader) throw new AdminUserError("请填写停用说明。");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 4096) { await reader.cancel(); throw new AdminUserError("请求内容过长。", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new AdminUserError("请求格式不正确。"); }
    const reason = body?.reason;
    if (typeof reason !== "string" || !reason.trim() || Array.from(reason.trim()).length > 500) throw new AdminUserError("停用说明应为 1 至 500 个字符。");
    return NextResponse.json(await disableAdminUser(actor, (await params).id, reason.trim()), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AdminUserError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("用户停用失败（敏感细节已隐藏）");
    return NextResponse.json({ error: "管理功能暂时不可用，请稍后重试。" }, { status: 503 });
  }
}
