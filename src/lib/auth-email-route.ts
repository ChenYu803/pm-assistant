import { NextResponse } from "next/server";
import { AuthRequestError, authClientAddress, limitAuthRequest } from "@/lib/auth-rate-limit";
import { EmailDeliveryError } from "@/lib/auth-email-delivery";
import { completeEmailVerification, sendEmailCode, validatedEmail, validatedPassword } from "@/lib/email-verification";

async function limitedRequestBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader)
    throw new AuthRequestError("请求格式不正确。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;
      length += value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        throw new AuthRequestError("请求内容过长。", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function emailAuthRoute(request: Request, action: "send" | "register" | "reset-password") {
  try {
    // AUTH_URL 是浏览器访问的公开地址；Next 内部 request.url 可能被规范化为其他主机。
    if (request.headers.get("origin") && request.headers.get("origin") !== new URL(process.env.AUTH_URL || request.url).origin)
      throw new AuthRequestError("不允许跨站提交认证请求。", 403);
    const address = authClientAddress(request);
    await limitAuthRequest("auth-request:" + address, 150, 900);
    const raw = await limitedRequestBody(request);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new AuthRequestError("请求格式不正确。");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AuthRequestError("请求格式不正确。");
    const email = validatedEmail(body.email);
    if (action === "send") {
      if (body.purpose !== "register" && body.purpose !== "reset-password")
        throw new AuthRequestError("验证码用途不正确。");
      return NextResponse.json(await sendEmailCode(email, body.purpose, address));
    }
    const password = validatedPassword(body.password);
    const user = await completeEmailVerification(email, action, body.code, password, address);
    return NextResponse.json(action === "register" ? user : { message: "密码已重置，请使用新密码登录。" }, { status: action === "register" ? 201 : 200 });
  } catch (error) {
    if (error instanceof AuthRequestError)
      return NextResponse.json({ error: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) }, { status: error.status, headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {} });
    if (error instanceof EmailDeliveryError)
      return NextResponse.json({ error: error.message, retryAfter: 60 }, { status: 503, headers: { "Retry-After": "60" } });
    if ((error as {
      code?: string;
    }).code === "ER_DUP_ENTRY")
      return NextResponse.json({ error: "该邮箱已被注册，请直接登录。" }, { status: 409 });
    // 不输出异常对象，供应商错误可能包含邮件正文或密钥。
    console.error("邮箱认证暂时不可用（敏感细节已隐藏）");
    return NextResponse.json({ error: "认证服务暂时不可用，请稍后重试。" }, { status: 503 });
  }
}
