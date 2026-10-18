/** 读取只有心跳与最终结果的 SSE；断流不能当作成功。保留旧 JSON 响应兼容。 */
export async function readGenerationResult(response: Response): Promise<{ polished?: string; error?: string }> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "AI 润色失败");
    return body;
  }
  if (!response.ok || !response.body) throw new Error("AI 润色响应不可读取");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: { status: number; body: { polished?: string; error?: string } } | undefined;
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.match(/^event:\s*(.+)$/m)?.[1] === "result") {
          const data = block.match(/^data:\s*(.+)$/m)?.[1];
          if (data) result = JSON.parse(data);
        }
      }
      if (chunk.done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!result || typeof result.status !== "number" || !result.body) throw new Error("AI 润色响应未完成，请重试");
  if (result.status >= 400) throw new Error(result.body.error || "AI 润色失败");
  if (typeof result.body.polished !== "string") throw new Error("AI 润色结果无效");
  return result.body;
}
