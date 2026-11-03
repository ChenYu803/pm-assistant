import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { readCreditStatement } from "@/lib/credits-ledger";
import { creditFailure, creditPage, creditResponse } from "@/lib/credits-route";
export async function GET(request: Request) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    return creditResponse(await readCreditStatement(userId, creditPage(request)));
  } catch (error) { return creditFailure(error); }
}
