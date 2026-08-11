import OpenAI from "openai";

/** DeepSeek chat model used across all agent calls.
 *  deepseek-chat/deepseek-reasoner 旧模型名已进入弃用通道（API 端此前静默映射到
 *  v4-flash，2026-08 实测弃用后不再可靠），显式使用 deepseek-v4-flash。 */
export const DEEPSEEK_MODEL = "deepseek-v4-flash";

/**
 * Create an OpenAI-compatible client pointed at the DeepSeek API.
 * SERVER-ONLY — do not import from client components.
 */
export function createDeepSeekClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
  });
}
