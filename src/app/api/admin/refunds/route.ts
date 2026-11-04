import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { creditFailure, creditRequestBody, creditResponse } from "@/lib/credits-route";
import { initiateManualRefund, listManualRefunds, parseManualRefund, refundFilters, RefundConflict } from "@/lib/manual-refunds";
export async function GET(request: Request) {
  try { const actor=await requireAdmin();if(actor instanceof NextResponse)return actor;const {q,page}=refundFilters(new URL(request.url).searchParams);return creditResponse(await listManualRefunds({q},page)); }
  catch(error) { return creditFailure(error); }
}
export async function POST(request: Request) {
  try {const actor=await requireAdmin();if(actor instanceof NextResponse)return actor;return creditResponse(await initiateManualRefund(actor,parseManualRefund(await creditRequestBody(request))));}
  catch(error) {if(error instanceof RefundConflict)return NextResponse.json({error:error.message,existing:error.existing},{status:409,headers:{"Cache-Control":"private, no-store"}});return creditFailure(error);}
}
