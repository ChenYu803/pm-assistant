export type GenerationResponse = { status: number; body: unknown };

export function createIterationGenerationStream(
  generate: (onContent: (content: string, messageId?: string) => void, signal: AbortSignal) => Promise<GenerationResponse>,
  heartbeatMs = 15_000,
  requestSignal?: AbortSignal,
) {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const generationController = new AbortController();
  const abortGeneration = () => generationController.abort();
  requestSignal?.addEventListener("abort", abortGeneration, { once: true });
  if (requestSignal?.aborted) abortGeneration();

  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          generationController.abort();
        }
      };

      heartbeat = setInterval(() => send("heartbeat", {}), heartbeatMs);
      void generate((content, messageId) => send("token", { content, messageId }), generationController.signal)
        .then((result) => send("result", result))
        .catch(() => send("result", { status: 500, body: { error: "生成失败，请刷新会话后重试。" } }))
        .finally(() => {
          if (heartbeat) clearInterval(heartbeat);
          requestSignal?.removeEventListener("abort", abortGeneration);
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      generationController.abort();
      requestSignal?.removeEventListener("abort", abortGeneration);
    },
  }), {
    headers: {
      "Cache-Control": "private, no-store, no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });

  return response;
}
