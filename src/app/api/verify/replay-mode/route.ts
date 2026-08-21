import { isLiveAI } from "@/lib/ai";

// 验证入口需要在发送任何聊天请求前确认服务端没有连接真实模型。
export const dynamic = "force-dynamic";

export function GET() {
  // 仅为本地固定回放验证提供状态，不暴露到生产环境。
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }

  return Response.json(
    { aiMode: isLiveAI() ? "live" : "replay" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
