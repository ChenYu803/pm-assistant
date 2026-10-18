import { getMysqlPool } from "@/lib/mysql";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getMysqlPool().query({ sql: "SELECT 1", timeout: 3000 });
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
