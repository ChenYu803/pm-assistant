// 验证测试观察器自身的协议识别与透明性，不替代完整浏览器业务回放。
import assert from "node:assert/strict";
import vm from "node:vm";
import { installFoundationStreamObserver, assertFoundationGeneration } from "./verify-foundation-stream-observer.mjs";

let pass = 0; let fail = 0;
function check(name, run) {
  try { run(); pass++; console.log(`✅ ${name}`); }
  catch (error) { fail++; console.error(`❌ ${name}：${error.message}`); }
}
async function observe(text, { status = 200, contentType = "text/event-stream", fragment = false } = {}) {
  const bytes = new TextEncoder().encode(text);
  const response = new Response(new ReadableStream({ start(controller) {
    if (fragment) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    else controller.enqueue(bytes);
    controller.close();
  } }), { status, headers: { "Content-Type": contentType } });
  const args = ["/api/iterations/i/stages/analysis/sessions/s/messages", { method: "POST", headers: { Accept: "text/event-stream" }, body: "原始请求" }];
  let forwarded;
  const window = { fetch: async (...value) => { forwarded = value; return response; } };
  vm.runInNewContext(`(${installFoundationStreamObserver.toString()})()`, { window, location: { href: "http://replay.test/" }, Request, TextDecoder, URL });
  const returned = await window.fetch(...args);
  const originalBody = await returned.text();
  const observation = window.__foundationStreams[0];
  for (let i = 0; !observation.ended && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  return { observation, response, returned, originalBody, forwarded, args };
}
const completed = 'event: heartbeat\r\ndata: {}\r\n\r\nevent: token\r\ndata: {"content":"中文👩‍💻","messageId":"m"}\r\n\r\nevent: result\r\ndata: {"status":200,\r\ndata: "body":{"ok":true}}\r\n\r\n';
const normal = await observe(completed, { fragment: true });
check("逐字节分块、组合 Unicode、CRLF 与多行 data 可完整读取", () => { assert.equal(normal.observation.tokens, 1); assert.equal(assertFoundationGeneration(normal.observation, 200).ok, true); });
check("观察器返回同一响应且不消费产品正文", () => { assert.equal(normal.returned, normal.response); assert.equal(normal.originalBody, completed); });
check("观察器不改请求参数和请求对象", () => { assert.equal(normal.forwarded[0], normal.args[0]); assert.equal(normal.forwarded[1], normal.args[1]); });
const stopped = 'event: result\ndata: {"status":409,"body":{"error":"生成已停止"}}\n\n';
const stop = await observe(stopped);
check("HTTP 200 与业务 result 409 正确分层", () => assert.equal(assertFoundationGeneration(stop.observation, 409).error, "生成已停止"));
for (const [name, text, options, expected, pattern] of [
  ["拒绝旧 HTTP 409 契约", stopped, { status: 409 }, 409, /HTTP 200/],
  ["拒绝 JSON 冒充 SSE", '{"status":200}', { contentType: "application/json" }, 200, /SSE/],
  ["只有 token 没有终态不能通过", 'event: token\ndata: {"content":"部分"}\n\n', {}, 200, /恰有一个 result/],
  ["重复终态不能通过", stopped + stopped, {}, 409, /恰有一个 result/],
  ["业务失败不能被 HTTP 200 掩盖", stopped, {}, 200, /业务状态为 409/],
  ["非停止错误不能冒充停止成功", 'event: result\ndata: {"status":409,"body":{"error":"其他错误"}}\n\n', {}, 409, /不是用户停止/],
  ["损坏 JSON 不能通过", 'event: result\ndata: {broken}\n\n', {}, 200, /JSON|property/],
  ["被截断事件不能通过", stopped.trimEnd(), {}, 409, /不完整/],
]) {
  const { observation } = await observe(text, options);
  check(name, () => assert.throws(() => assertFoundationGeneration(observation, expected), pattern));
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
