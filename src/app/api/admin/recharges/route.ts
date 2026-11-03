import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { creditFailure,creditRequestBody,creditResponse } from "@/lib/credits-route";
import { creditManualRecharge,listManualRecharges,parseManualRecharge,rechargeFilters,RechargeConflict } from "@/lib/manual-recharges";
export async function GET(request:Request) {
 try {const actor=await requireAdmin();if(actor instanceof NextResponse)return actor;const {q,page}=rechargeFilters(new URL(request.url).searchParams);return creditResponse(await listManualRecharges(q,page));}catch(error){return creditFailure(error);}
}
export async function POST(request:Request) {
 try {const actor=await requireAdmin();if(actor instanceof NextResponse)return actor;return creditResponse(await creditManualRecharge(actor,parseManualRecharge(await creditRequestBody(request))));}
 catch(error){if(error instanceof RechargeConflict)return NextResponse.json({error:error.message,existing:error.existing},{status:409,headers:{"Cache-Control":"private, no-store"}});return creditFailure(error);}
}
