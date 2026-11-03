import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adjustCredits, parseCreditAdjustment, readCreditStatement } from "@/lib/credits-ledger";
import { creditFailure, creditPage, creditRequestBody, creditResponse } from "@/lib/credits-route";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireAdmin();
    if (actor instanceof NextResponse) return actor;
    return creditResponse(await readCreditStatement((await params).id, creditPage(request)));
  } catch (error) { return creditFailure(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await requireAdmin();
    if (actor instanceof NextResponse) return actor;
    const input = parseCreditAdjustment(await creditRequestBody(request));
    return creditResponse(await adjustCredits(actor, (await params).id, input));
  } catch (error) { return creditFailure(error); }
}
