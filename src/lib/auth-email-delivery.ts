import { emailTestBoundary } from "@/lib/auth-email-test-boundary";

export class EmailDeliveryError extends Error {
}
/** 不记录上游响应正文，避免供应商回显邮件内容或凭据。 */
export async function deliverEmailCode(email: string, code: string, purpose: "register" | "reset-password") {
  const test = emailTestBoundary();
  try {
    if (test) {
      const response = await fetch(test.url + "/send", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + test.token }, body: JSON.stringify({ email, code, purpose }), signal: AbortSignal.timeout(10000) });
      if (!response.ok)
        throw new Error();
      return;
    }
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from || /[\r\n]/.test(from) || !from.includes("@"))
      throw new EmailDeliveryError("邮件服务尚未配置，请联系网站运营者。");
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify({ from, to: [email], subject: purpose === "register" ? "AI 产品现场注册验证码" : "AI 产品现场密码找回验证码", text: "您的" + (purpose === "register" ? "注册" : "密码找回") + "验证码为：" + code + "。10 分钟内有效，请勿告诉他人；重新发送后旧码失效。若非本人操作，请忽略。" }), signal: AbortSignal.timeout(15000) });
    if (!response.ok || !(await response.json()).id)
      throw new Error();
  } catch (error) {
    if (error instanceof EmailDeliveryError)
      throw error;
    throw new EmailDeliveryError("邮件发送失败，请稍后重试或联系网站运营者。");
  }
}
