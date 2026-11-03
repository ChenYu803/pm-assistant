import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listAdminUsers } from "@/lib/admin-users";

export async function GET(request: Request) {
  try {
    const actor = await requireAdmin();
    if (actor instanceof NextResponse) return actor;
    const params = new URL(request.url).searchParams;
    const search = (params.get("q") ?? "").trim(), status = params.get("status") ?? "all", page = Number(params.get("page") ?? "1");
    if (search.length > 320 || !["all", "active", "disabled"].includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 1000000) return NextResponse.json({ error: "查询条件不正确。" }, { status: 400 });
    return NextResponse.json(await listAdminUsers(search, status, page), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    console.error("用户管理查询失败（敏感细节已隐藏）");
    return NextResponse.json({ error: "管理功能暂时不可用，请稍后重试。" }, { status: 503 });
  }
}
