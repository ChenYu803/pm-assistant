import OpenAI from "openai";

/** DeepSeek chat model used across all agent calls. */
export const DEEPSEEK_MODEL = "deepseek-chat";

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
