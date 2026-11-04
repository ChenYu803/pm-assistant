import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { creditFailure, creditResponse } from "@/lib/credits-route";
import { creditPage } from "@/lib/credits-route";
import { listRefundSources } from "@/lib/manual-refunds";
export async function GET(request: Request) {
  try {
    const actor=await requireAdmin();if(actor instanceof NextResponse)return actor;
    const params=new URL(request.url).searchParams,accountId=params.get("accountId")??"";
    params.delete("accountId");const pagination=new URL(request.url);pagination.search=params.toString();
    return creditResponse(await listRefundSources(accountId,creditPage(new Request(pagination))));
  } catch(error) {return creditFailure(error);}
}
