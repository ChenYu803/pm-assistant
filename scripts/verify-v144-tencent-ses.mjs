// 仅替换腾讯云 SDK 的公开发送边界；不联网、不读取真实凭据、不操作数据库。
import assert from "node:assert/strict";
import { ses } from "tencentcloud-sdk-nodejs-ses";
import { deliverEmailCode, EmailDeliveryError } from "../src/lib/auth-email-delivery.ts";
import { tencentSesConfigurationErrors } from "../src/lib/tencent-ses-config.ts";
import { productionConfigurationErrors } from "../src/lib/production-config.ts";
let pass = 0, fail = 0;
async function check(name, action) {
  try { await action(); pass++; console.log("✅ " + name); }
  catch { fail++; console.error("❌ " + name); }
}
const originalEnv = { ...process.env };
const originalSend = ses.v20201002.Client.prototype.SendEmail;
const originalFetch = globalThis.fetch;
const settings = {
  TENCENT_SES_SECRET_ID: "isolated-ses-secret-id-123456789",
  TENCENT_SES_SECRET_KEY: "isolated-ses-secret-key-123456789",
  TENCENT_SES_REGION: "ap-guangzhou",
  TENCENT_SES_REGISTER_TEMPLATE_ID: "68248", TENCENT_SES_RESET_TEMPLATE_ID: "68249",
  EMAIL_FROM: "noreply@mail.ideastage.top",
};
const validEnv = {
  NODE_ENV: "production", MYSQL_HOST: "127.0.0.1", MYSQL_PORT: "3306", MYSQL_DATABASE: "isolated_fixture", MYSQL_USER: "isolated_app",
  MYSQL_PASSWORD: "isolated-db-secret-123456789", AUTH_SECRET: "isolated-auth-secret-12345678901234567890", MYSQL_REQUIRED_VERSION: "9.7",
  AUTH_URL: "https://ideastage.top", AUTH_TRUST_HOST: "true", AI_MODE: "replay", ...settings,
};
let calls = [];
try {
  // 隔离所有继承的邮件/模型配置，任何 fetch 调用都立即失败。
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, validEnv);
  globalThis.fetch = async () => { throw new Error("离线验证禁止网络访问"); };
  ses.v20201002.Client.prototype.SendEmail = async function (request) { calls.push(request); return { MessageId: "accepted-isolated" }; };
  await check("注册邮件使用注册模板、单个收件人、六位验证码和即时通道", async () => {
    await deliverEmailCode("receiver@test.local", "135790", "register");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { FromEmailAddress: settings.EMAIL_FROM, Destination: ["receiver@test.local"], Subject: "AI 产品现场注册验证码", Template: { TemplateID: 68248, TemplateData: '{"code":"135790"}' }, TriggerType: 1 });
  });
  await check("找回邮件使用独立模板与标题", async () => {
    await deliverEmailCode("receiver@test.local", "246801", "reset-password");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].Template.TemplateID, 68249);
    assert.equal(calls[1].Subject, "AI 产品现场密码找回验证码");
    assert.equal(calls[1].Template.TemplateData, '{"code":"246801"}');
  });
  await check("仅腾讯云配置即可通过生产预检，无需 Resend", () => assert.deepEqual(productionConfigurationErrors(validEnv), []));
  await check("每个必需邮件字段缺失都会阻断生产预检，错误不回显凭据", () => {
    for (const name of Object.keys(settings)) {
      const errors = productionConfigurationErrors({ ...validEnv, [name]: "" });
      assert(errors.some(error => error.includes(name)));
      assert(!errors.join(" ").includes(settings.TENCENT_SES_SECRET_KEY));
    }
  });
  await check("拒绝错误模板ID、发件人注入和占位凭据", () => {
    for (const patch of [{ TENCENT_SES_REGISTER_TEMPLATE_ID: "0" }, { TENCENT_SES_RESET_TEMPLATE_ID: "1.5" }, { TENCENT_SES_REGISTER_TEMPLATE_ID: "9007199254740992" }, { EMAIL_FROM: "a@test.local\r\nBcc:other@test.local" }, { EMAIL_FROM: "wrong" }, { TENCENT_SES_SECRET_KEY: "replace-with-your-secret" }, { TENCENT_SES_REGION: "" }]) assert(tencentSesConfigurationErrors({ ...settings, ...patch }).length > 0);
    assert.deepEqual(tencentSesConfigurationErrors({ ...settings, EMAIL_FROM: "AI 产品现场 <noreply@mail.ideastage.top>" }), []);
  });
  await check("缺少腾讯云配置时不回退 Resend，不调用发送边界", async () => {
    const before = calls.length;
    process.env.TENCENT_SES_SECRET_KEY = ""; process.env.RESEND_API_KEY = "isolated-unused-resend-key";
    try { await assert.rejects(() => deliverEmailCode("receiver@test.local", "135790", "register"), error => error instanceof EmailDeliveryError && error.message === "邮件服务尚未配置，请联系网站运营者。"); }
    finally { process.env.TENCENT_SES_SECRET_KEY = settings.TENCENT_SES_SECRET_KEY; delete process.env.RESEND_API_KEY; }
    assert.equal(calls.length, before);
  });
  await check("供应商拒绝只返回安全错误，不回显内容和凭据，也不自动重试", async () => {
    let attempts = 0;
    ses.v20201002.Client.prototype.SendEmail = async () => { attempts++; throw new Error(settings.TENCENT_SES_SECRET_KEY + " 135790 receiver@test.local"); };
    await assert.rejects(() => deliverEmailCode("receiver@test.local", "135790", "register"), error => error instanceof EmailDeliveryError && error.message === "邮件发送失败，请稍后重试或联系网站运营者。");
    assert.equal(attempts, 1);
  });
  await check("缺少服务商消息标识时不能声称发送成功", async () => {
    ses.v20201002.Client.prototype.SendEmail = async () => ({ RequestId: "isolated-only-request" });
    await assert.rejects(() => deliverEmailCode("receiver@test.local", "135790", "register"), EmailDeliveryError);
  });
} finally {
  ses.v20201002.Client.prototype.SendEmail = originalSend;
  globalThis.fetch = originalFetch;
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, originalEnv);
}
console.log(JSON.stringify({ pass, fail, externalRequests: 0, databaseWrites: 0 }));
process.exit(fail > 0 ? 1 : 0);
