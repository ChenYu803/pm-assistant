/** 发信配置只在服务端读取；预检错误仅包含字段名，不回显凭据。 */
export function tencentSesConfigurationErrors(env: NodeJS.ProcessEnv) {
  const errors: string[] = [];
  for (const name of ["TENCENT_SES_SECRET_ID", "TENCENT_SES_SECRET_KEY"]) {
    const value = env[name] ?? "";
    if (value.length < 16 || /\s|replace|your-|placeholder|example/i.test(value)) errors.push(name + " 需填写专用发信子用户的真实凭据");
  }
  if (!/^[a-z]+(?:-[a-z0-9]+)+$/.test(env.TENCENT_SES_REGION ?? "")) errors.push("TENCENT_SES_REGION 需填写模板所在地域，如 ap-guangzhou");
  for (const name of ["TENCENT_SES_REGISTER_TEMPLATE_ID", "TENCENT_SES_RESET_TEMPLATE_ID"]) {
    const value = env[name] ?? "";
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) errors.push(name + " 需填写已审核通过的正整数模板 ID");
  }
  const mailbox = "[^\\s<>@]+@[^\\s<>@]+\\.[^\\s<>@]+";
  const from = env.EMAIL_FROM ?? "";
  if (/[\r\n]/.test(from) || !new RegExp("^(?:" + mailbox + "|[^<>:]+ <" + mailbox + ">)$").test(from)) errors.push("EMAIL_FROM 需为腾讯云 SES 已验证域名下已创建的发信地址");
  return errors;
}

export function getTencentSesConfiguration(env: NodeJS.ProcessEnv = process.env) {
  if (tencentSesConfigurationErrors(env).length) throw new Error("腾讯云 SES 邮件配置不完整");
  return {
    secretId: env.TENCENT_SES_SECRET_ID!,
    secretKey: env.TENCENT_SES_SECRET_KEY!,
    region: env.TENCENT_SES_REGION!,
    from: env.EMAIL_FROM!,
    registerTemplateId: Number(env.TENCENT_SES_REGISTER_TEMPLATE_ID),
    resetTemplateId: Number(env.TENCENT_SES_RESET_TEMPLATE_ID),
  };
}
