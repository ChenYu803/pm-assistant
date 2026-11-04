import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { creditFailure, creditRequestBody, creditResponse } from "@/lib/credits-route";
import { processManualRefund, RefundConflict } from "@/lib/manual-refunds";
export async function PATCH(request: Request,{params}:{params:Promise<{id:string}>}) {
  try {const actor=await requireAdmin();if(actor instanceof NextResponse)return actor;const {id}=await params;return creditResponse(await processManualRefund(actor,id,await creditRequestBody(request)));}
  catch(error) {if(error instanceof RefundConflict)return NextResponse.json({error:error.message,existing:error.existing},{status:409,headers:{"Cache-Control":"private, no-store"}});return creditFailure(error);}
}
