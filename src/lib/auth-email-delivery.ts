import { ses } from "tencentcloud-sdk-nodejs-ses";
import { emailTestBoundary } from "@/lib/auth-email-test-boundary";
import { getTencentSesConfiguration } from "@/lib/tencent-ses-config";

export class EmailDeliveryError extends Error {
}
/** 不记录上游响应正文，避免供应商回显邮件内容或凭据。 */
export async function deliverEmailCode(email: string, code: string, purpose: "register" | "reset-password") {
  const test = emailTestBoundary();
  try {
    if (test) {
      const response = await fetch(test.url + "/send", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + test.token }, body: JSON.stringify({ email, code, purpose }), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error();
      return;
    }
    let config;
    try { config = getTencentSesConfiguration(); }
    catch { throw new EmailDeliveryError("邮件服务尚未配置，请联系网站运营者。"); }
    const client = new ses.v20201002.Client({
      credential: { secretId: config.secretId, secretKey: config.secretKey },
      region: config.region,
      profile: { signMethod: "TC3-HMAC-SHA256", httpProfile: { reqTimeout: 15 } },
    });
    // 使用已审核模板和验证码即时通道；每次只投递给当前收件人，不自动重发。
    const response = await client.SendEmail({
      FromEmailAddress: config.from,
      Destination: [email],
      Subject: purpose === "register" ? "AI 产品现场注册验证码" : "AI 产品现场密码找回验证码",
      Template: { TemplateID: purpose === "register" ? config.registerTemplateId : config.resetTemplateId, TemplateData: JSON.stringify({ code }) },
      TriggerType: 1,
    });
    // MessageId 只证明服务商受理；真实收件箱送达由目标机验收确认。
    if (!response.MessageId) throw new Error();
  } catch (error) {
    if (error instanceof EmailDeliveryError) throw error;
    throw new EmailDeliveryError("邮件发送失败，请稍后重试或联系网站运营者。");
  }
}
