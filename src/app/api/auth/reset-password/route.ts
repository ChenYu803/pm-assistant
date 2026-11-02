import { emailAuthRoute } from "@/lib/auth-email-route";
export const runtime = "nodejs";
export async function POST(request: Request) { return emailAuthRoute(request, "reset-password"); }
