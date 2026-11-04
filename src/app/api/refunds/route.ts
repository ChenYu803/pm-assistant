import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { creditFailure, creditPage, creditResponse } from "@/lib/credits-route";
import { listManualRefunds } from "@/lib/manual-refunds";
export async function GET(request: Request) {
  try {const userId=await requireAuth();if(userId instanceof NextResponse)return userId;return creditResponse(await listManualRefunds({accountId:userId},creditPage(request)));}
  catch(error) {return creditFailure(error);}
}
