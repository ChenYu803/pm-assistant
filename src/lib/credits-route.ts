import { NextResponse } from "next/server";
import { CreditError } from "@/lib/credit-values";
export const creditResponse = (value: unknown) => NextResponse.json(value, { headers: { "Cache-Control": "private, no-store" } });
export function creditPage(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== "page")) throw new CreditError("查询仅支持分页，不能指定其他账号。");
  const page = Number(params.get("page") ?? "1");
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new CreditError("页码不正确。");
  return page;
}
export async function creditRequestBody(request: Request): Promise<unknown> {
  if (request.headers.get("sec-fetch-site") === "cross-site" || (request.headers.get("origin") && request.headers.get("origin") !== new URL(process.env.AUTH_URL || request.url).origin) || !request.headers.get("content-type")?.startsWith("application/json")) throw new CreditError("不允许此请求。", 403);
  const reader = request.body?.getReader();
  if (!reader) throw new CreditError("请填写调整内容。");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new CreditError("请求内容过长。", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new CreditError("请求格式不正确。"); }
}
export function creditFailure(error: unknown) {
  if (error instanceof CreditError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
  console.error("积分操作失败（敏感细节已隐藏）");
  return NextResponse.json({ error: "积分服务暂时不可用，请保留当前操作内容并重试。" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
}
