import type { PolishResult } from "@/lib/polish-result";

export class GenerationResultError extends Error {
  constructor(public status: number, public result: PolishResult) {
    super(result.error || "AI 润色失败");
  }
}

/** 心跳与 JSON 使用同一结果契约；即使业务失败，也保留本次费用与重试身份。 */
export async function readGenerationResult(response: Response): Promise<PolishResult> {
  let result: { status: number; body: PolishResult } | undefined;
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    result = { status: response.status, body: await response.json() };
  } else {
    if (!response.ok || !response.body) throw new Error("AI 润色响应不可读取，请保留原请求重试");
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value ?? new Uint8Array(),{stream:!chunk.done});
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0,boundary);
          buffer = buffer.slice(boundary+2);
          if (block.match(/^event:\s*(.+)$/m)?.[1] === "result") {
            const data = block.match(/^data:\s*(.+)$/m)?.[1];
            if (data) result = JSON.parse(data);
          }
        }
        if (chunk.done) break;
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  if (!result || typeof result.status !== "number" || !result.body) throw new Error("AI 润色响应未完成，请保留原请求重试");
  if (result.status >= 400) throw new GenerationResultError(result.status,result.body);
  if (result.status !== 202 && typeof result.body.polished !== "string") throw new Error("AI 润色结果无效，请保留原请求重试");
  return result.body;
}
