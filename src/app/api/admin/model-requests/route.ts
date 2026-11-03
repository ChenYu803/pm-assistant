import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listModelRequests, modelRequestQuery } from "@/lib/model-request-ledger";
export async function GET(request: Request) {
 const actor = await requireAdmin(); if (actor instanceof NextResponse) return actor;
 let query; try { query = modelRequestQuery(new URL(request.url).searchParams); } catch { return NextResponse.json({ error: "查询条件不正确。" }, { status: 400 }); }
 try { return NextResponse.json(await listModelRequests(query), { headers: { "Cache-Control": "private, no-store" } }); }
 catch { console.error("模型成本查询失败（敏感细节已隐藏）"); return NextResponse.json({ error: "成本查询暂时不可用，请稍后重试。" }, { status: 503 }); }
}
