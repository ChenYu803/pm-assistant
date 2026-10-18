import { createHash, timingSafeEqual } from "node:crypto";

export function registrationMode(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.REGISTRATION_MODE ?? (env.NODE_ENV === "production" ? "invite" : "open");
  if (mode !== "invite" && mode !== "open") throw new Error("REGISTRATION_MODE 必须为 invite 或 open");
  return mode;
}

export function validRegistrationInvite(value: unknown, env: NodeJS.ProcessEnv = process.env) {
  if (registrationMode(env) === "open") return true;
  const secret = env.REGISTRATION_INVITE_CODE;
  if (!secret || typeof value !== "string" || value.length > 256) return false;
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(value.trim()), digest(secret));
}

export function positiveSetting(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env) {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} 必须为正整数`);
  return value;
}
