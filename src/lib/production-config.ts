import { getMysqlAppConfig } from "@/lib/mysql-config";
import { positiveSetting, registrationMode } from "@/lib/launch-policy";

/** 仅返回字段名和修复建议，不包含秘密值。可离线运行，不连接数据库。 */
export function productionConfigurationErrors(env: NodeJS.ProcessEnv) {
  const errors: string[] = [];
  const secret = (name: string, min: number) => {
    const value = env[name] ?? "";
    if (value.length < min || /replace|your-|placeholder|example/i.test(value)) errors.push(`${name} 需替换为至少 ${min} 位随机值`);
  };
  secret("AUTH_SECRET", 32);
  secret("MYSQL_PASSWORD", 24);
  try { getMysqlAppConfig(env); } catch { errors.push("MySQL 应用连接字段不完整或不合法；网站不能使用 root"); }
  if (env.MYSQL_HOST !== "127.0.0.1") errors.push("当前单机方案 MYSQL_HOST 应为 127.0.0.1");
  if (env.MYSQL_REQUIRED_VERSION !== "9.7.2") errors.push("MYSQL_REQUIRED_VERSION 应为已验收的 9.7.2");
  try {
    const url = new URL(env.AUTH_URL ?? "");
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password || !url.hostname.includes(".") || url.hostname.endsWith(".invalid")) throw new Error();
  } catch { errors.push("AUTH_URL 需为实际网站的 HTTPS 根地址"); }
  if (env.AUTH_TRUST_HOST !== "true") errors.push("受 nginx 保护的单机部署需要 AUTH_TRUST_HOST=true");
  if (!["live", "replay"].includes(env.AI_MODE ?? "")) errors.push("必须显式配置 AI_MODE=replay 或 live");
  if (env.AI_MODE === "live") {
    secret("AI_API_KEY", 16);
    try { if (new URL(env.AI_BASE_URL ?? "").protocol !== "https:") throw new Error(); } catch { errors.push("AI_BASE_URL 需为 HTTPS API 地址"); }
    if (!env.AI_MODEL?.trim()) errors.push("AI_MODEL 不可为空");
  }
  try { if (registrationMode(env) === "invite") secret("REGISTRATION_INVITE_CODE", 16); } catch { errors.push("REGISTRATION_MODE 需为 invite 或 open"); }
  for (const name of ["AI_DAILY_USER_LIMIT", "AI_DAILY_SITE_LIMIT"]) {
    try { positiveSetting(name, name.includes("USER") ? 10 : 100, env); } catch { errors.push(`${name} 需为正整数`); }
  }
  if (Object.keys(env).some((name) => /MYSQL_(ADMIN|MIGRATION)_/.test(name) && env[name])) errors.push("网站运行配置不可携带 MySQL 初始化/迁移维护凭据");
  return errors;
}
