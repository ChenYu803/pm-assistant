// 基础回放专用：旁路观察浏览器 fetch 的副本，不改请求、响应或产品消费路径。
export function installFoundationStreamObserver() {
  const observations = [];
  window.__foundationStreams = observations;
  const fetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await fetch.apply(window, args);
    const request = args[0];
    const path = new URL(request instanceof Request ? request.url : String(request), location.href).pathname;
    const method = (args[1]?.method ?? (request instanceof Request ? request.method : "GET")).toUpperCase();
    if (method !== "POST" || !/^\/api\/iterations\/[^/]+\/stages\/[^/]+\/sessions\/[^/]+\/messages$/.test(path)) return response;
    const observation = { path, httpStatus: response.status, contentType: response.headers.get("content-type"), tokens: 0, results: [], error: null, ended: false };
    observations.push(observation);
    void (async () => {
      try {
        if (!observation.contentType?.includes("text/event-stream")) throw new Error("消息响应不是 SSE");
        const reader = response.clone().body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const chunk = await reader.read();
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop();
          for (const frame of frames) {
            const event = frame.match(/^event:\s*(.+)$/m)?.[1].trim();
            const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
            if (!data) continue;
            const payload = JSON.parse(data);
            if (event === "token" && typeof payload.content === "string" && payload.content) observation.tokens++;
            if (event === "result") observation.results.push(payload);
          }
          if (chunk.done) break;
        }
        if (buffer.trim()) throw new Error("流结束后存在不完整 SSE 事件");
      } catch (error) {
        observation.error = error instanceof Error ? error.message : String(error);
      } finally {
        observation.ended = true;
      }
    })();
    return response;
  };
}

export function assertFoundationGeneration(observation, expectedStatus) {
  if (observation.httpStatus !== 200 || !observation.contentType?.includes("text/event-stream")) throw new Error("消息请求没有建立 HTTP 200 SSE 流");
  if (!observation.ended || observation.error) throw new Error(observation.error || "消息流尚未结束");
  if (observation.results.length !== 1) throw new Error("消息流必须恰有一个 result 终态");
  const result = observation.results[0];
  if (result.status !== expectedStatus) throw new Error(`消息业务状态为 ${result.status}，预期 ${expectedStatus}`);
  if (expectedStatus === 409 && result.body?.error !== "生成已停止") throw new Error("409 不是用户停止生成的业务终态");
  return result.body;
}
