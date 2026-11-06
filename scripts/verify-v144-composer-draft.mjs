// 真实工作台组件回归；仅替换子组件与网络，不访问浏览器、数据库或模型。
// 临时依赖（不改仓库）：npm install --prefix "$env:TEMP/agent2-ui-renderer-19.2.8" --no-save --package-lock=false --ignore-scripts react-test-renderer@19.2.8
// 运行：node scripts/verify-v144-composer-draft.mjs；加 --revision=f35c4f2 可只读复现基线红灯
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";

const rendererRequire = createRequire(join(process.env.UI_RENDERER_ROOT ?? join(tmpdir(), "agent2-ui-renderer-19.2.8"), "package.json"));
const React = rendererRequire("react");
const { create, act } = rendererRequire("react-test-renderer");
const componentPath = new URL("../src/components/ProductIterationWorkbench.tsx", import.meta.url);
const revision = process.argv.find(argument => argument.startsWith("--revision="))?.slice("--revision=".length);
// 基线也运行完整组件，仅从 git 读取源码，不替换工作区文件。
const componentSource = revision ? execFileSync("git", ["show", revision + ":src/components/ProductIterationWorkbench.tsx"], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" }) : readFileSync(componentPath, "utf8");
const code = ts.transpileModule(componentSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const longPrompt = "请分析校园二手交易的用户需求，并给出可执行的访谈计划。".repeat(150);

async function mount(initialMessages = []) {
  const timers = new Map();
  const storage = new Map();
  const history = new Map([["a", initialMessages], ["b", []]]);
  const streams = new Map();
  const unexpected = [];
  let timerId = 0;
  let rejectSend = false;
  let rejectStream = false;
  let posts = 0;
  const sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const window = {
    sessionStorage, matchMedia: () => ({ matches: false }), dispatchEvent() {},
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms, interval: false }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms, interval: true }); return id; },
    clearInterval: id => timers.delete(id), requestAnimationFrame: fn => fn(),
  };
  const state = () => ({ currentStage: "analysis", stages: ["analysis", "prototype", "prd", "tickets"].map(key => ({ key, status: key === "analysis" ? "in_progress" : "not_started", sessions: key === "analysis" ? [{ id: "a", title: "会话A" }, { id: "b", title: "会话B" }] : [], generatingSessionIds: [...streams].filter(([, value]) => !value.stopped && !value.finished).map(([id]) => id) })) });
  const json = (value, status = 200) => Response.json(value, { status });
  const fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    if (url.endsWith("/workbench")) return json(method === "PATCH" ? { status: "in_progress" } : state());
    if (url === "/api/projects/p/files") return json([]);
    if (url.endsWith("/context")) return json({ fileIds: [] });
    const sessionId = url.match(/\/sessions\/([^/]+)/)?.[1];
    if (url.endsWith("/messages") && method === "GET") return json({ messages: history.get(sessionId) });
    if (url.endsWith("/messages") && method === "POST") {
      posts += 1;
      if (rejectSend) return json({ error: "积分不足" }, 402);
      if (rejectStream) return new Response('event: result\ndata: {"status":402,"body":{"error":"积分不足"}}\n\n', { headers: { "Content-Type": "text/event-stream" } });
      const { content } = JSON.parse(init.body);
      const stream = { content, stopped: false, finished: false, accepted: false };
      streams.set(sessionId, stream);
      return new Response(new ReadableStream({ start(controller) { stream.controller = controller; } }), { headers: { "Content-Type": "text/event-stream" } });
    }
    if (url.endsWith("/stop") && method === "POST") {
      const stream = streams.get(sessionId);
      stream.stopped = true;
      history.set(sessionId, history.get(sessionId).map(row => row.role === "assistant" ? { ...row, status: "interrupted" } : row));
      return json({ stopped: true });
    }
    unexpected.push(`${method} ${url}`);
    throw new Error(`未模拟请求：${method} ${url}`);
  };
  const leaf = () => null;
  const exports = {};
  const sandbox = { exports, Error, TextDecoder, Uint8Array, Event, crypto: webcrypto, sessionStorage, window, fetch, console, require: id => {
    if (id === "react" || id === "react/jsx-runtime") return rendererRequire(id);
    if (id.endsWith(".module.css")) return { default: {} };
    if (id === "@/lib/workbench-file-branch") return { getWorkbenchFileStage: () => "analysis" };
    if (id === "@/components/ConversationCredits") return { AccountCredits: leaf, ReplyCredits: leaf };
    if (id === "next/link") return { default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (id.startsWith("@/components/")) return { default: leaf };
    throw new Error(`未模拟依赖：${id}`);
  } };
  vm.runInNewContext(code, sandbox, { filename: componentPath.pathname });
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.default, { project: { id: "p", name: "测试项目" }, iteration: { id: "i", project_id: "p", iteration_number: 1, display_name: "测试迭代", goal: null } })); });
  async function flush() {
    for (let round = 0; round < 8; round += 1) {
      await act(async () => {
        const due = [...timers].filter(([, timer]) => !timer.interval && timer.ms === 0);
        for (const [id, timer] of due) { timers.delete(id); timer.fn(); }
        for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
      });
    }
  }
  const textarea = () => renderer.root.findByProps({ "aria-label": "输入消息" });
  async function change(value) {
    assert.equal(textarea().props.disabled, false, "只能在可输入时编辑草稿");
    await act(async () => { textarea().props.onChange({ target: { value } }); });
  }
  async function submit() {
    const button = renderer.root.findAllByType("button").find(node => node.props.type === "submit" && node.children.includes("发送消息"));
    assert.ok(button && !button.props.disabled, "发送按钮必须可用");
    await act(async () => { renderer.root.findByProps({ className: "workbench-composer" }).props.onSubmit({ preventDefault() {} }); });
    await flush();
  }
  function accept(id = "a", token = true) {
    const stream = streams.get(id);
    if (!stream.accepted) {
      stream.accepted = true;
      history.set(id, [...history.get(id), { id: `u-${posts}`, role: "user", content: stream.content, status: "completed" }, { id: `r-${posts}`, role: "assistant", content: token ? "部分回复" : "", status: "generating" }]);
    }
    if (token) stream.controller.enqueue(new TextEncoder().encode(`event: token\ndata: ${JSON.stringify({ content: "部分回复", messageId: `r-${posts}` })}\n\n`));
  }
  async function stop() {
    await act(async () => { renderer.root.findByProps({ className: "stop-generation-button" }).props.onClick(); });
    await flush();
    assert.ok(streams.get("a").stopped, "已调用停止接口");
    assert.equal(streams.get("a").finished, false, "断言发生在发送异步尚未结束时");
  }
  async function finish(id = "a", broken = false) {
    const stream = streams.get(id);
    await act(async () => {
      stream.finished = true;
      if (broken) stream.controller.error(new Error("模拟连接中断"));
      else {
        history.set(id, history.get(id).map(row => row.role === "assistant" ? { ...row, status: stream.stopped ? "interrupted" : "completed" } : row));
        stream.controller.enqueue(new TextEncoder().encode(`event: result\ndata: ${JSON.stringify({ status: 200, body: { messages: history.get(id) } })}\n\n`));
        stream.controller.close();
      }
    });
    await flush();
  }
  async function select(id) {
    await act(async () => { renderer.root.findByProps({ "data-session-id": id }).props.onClick(); });
    await flush();
  }
  async function poll() {
    await act(async () => { for (const timer of [...timers.values()]) if (timer.interval && timer.ms === 1000) timer.fn(); });
    await flush();
  }
  await flush();
  assert.equal(textarea().props.disabled, false, "真实组件已加载会话");
  return { textarea, change, submit, accept, stop, finish, select, poll, flush, history, reject: () => { rejectSend = true; }, rejectSse: () => { rejectStream = true; }, dispose: async () => { await act(async () => renderer.unmount()); assert.deepEqual(unexpected, []); } };
}

// React renderer 的弃用提示与用例无关；保留其他告警。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalError = console.error;
console.error = (...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) originalError(...args); };
let pass = 0;
let fail = 0;
async function check(name, run, initialMessages) {
  let ui;
  try { ui = await mount(initialMessages); await run(ui); pass += 1; console.log(`✅ ${name}`); }
  catch (error) { fail += 1; console.error(`❌ ${name}：${error.message}`); }
  finally { if (ui) await ui.dispose(); }
}
await check("长提示已接纳，发送尚未结束时主动停止应清空原草稿", async ui => {
  await ui.change(longPrompt);
  await ui.submit();
  ui.accept();
  await ui.flush();
  await ui.stop();
  assert.equal(ui.textarea().props.value.length, 0, "停止后仍残留原提示，字符数=" + ui.textarea().props.value.length);
  await ui.finish("a", true);
});
await check("最小复现：短提示、零 token、持久接纳后停止", async ui => {
  await ui.change("短提示"); await ui.submit(); ui.accept("a", false); await ui.stop();
  assert.equal(ui.textarea().props.value, ""); await ui.finish("a", true);
});
await check("接纳后断流，重载确认用户消息后清原草稿", async ui => {
  await ui.change("断流提示"); await ui.submit(); ui.accept("a", false); await ui.finish("a", true);
  assert.equal(ui.textarea().props.value, "");
});
await check("发送被拒绝，保留完整长草稿", async ui => {
  ui.reject(); await ui.change(longPrompt); await ui.submit();
  assert.equal(ui.textarea().props.value, longPrompt);
});
await check("未接纳的请求断流，保留原草稿", async ui => {
  await ui.change("尚未接纳"); await ui.submit(); await ui.finish("a", true);
  assert.equal(ui.textarea().props.value, "尚未接纳");
});
await check("正常完成清空已发送草稿", async ui => {
  await ui.change("正常提示"); await ui.submit(); ui.accept("a", false); await ui.finish();
  assert.equal(ui.textarea().props.value, "");
});
await check("停止不等于接纳：未持久化的提示仍保留", async ui => {
  await ui.change("未保存的提示"); await ui.submit(); await ui.stop();
  assert.equal(ui.textarea().props.value, "未保存的提示"); await ui.finish("a", true);
});
await check("生成中可写新草稿，旧请求完成不误清", async ui => {
  await ui.change("本次发送"); await ui.submit(); await ui.change("下一条新草稿");
  ui.accept("a", false); await ui.finish();
  assert.equal(ui.textarea().props.value, "下一条新草稿");
});
await check("重新编辑为相同文本也属于新草稿", async ui => {
  await ui.change("相同提示"); await ui.submit(); await ui.change("临时修改"); await ui.change("相同提示");
  ui.accept("a", false); await ui.finish(); assert.equal(ui.textarea().props.value, "相同提示");
});
await check("切换会话后，A迟到完成不清B草稿，A原草稿已清", async ui => {
  await ui.change("A提示"); await ui.submit(); ui.accept("a", false);
  await ui.select("b"); await ui.change("B独立草稿"); await ui.finish("a");
  assert.equal(ui.textarea().props.value, "B独立草稿"); await ui.select("a"); assert.equal(ui.textarea().props.value, "");
});
await check("历史同文用户消息不能冒充本次接纳", async ui => {
  await ui.change("重复提示"); await ui.submit(); await ui.finish("a", true);
  assert.equal(ui.textarea().props.value, "重复提示");
}, [{ id: "old-user", role: "user", content: "重复提示", status: "completed" }]);
await check("HTTP200但流内402拒绝，完整保留草稿", async ui => {
  ui.rejectSse(); await ui.change(longPrompt); await ui.submit();
  assert.equal(ui.textarea().props.value, longPrompt);
});
await check("轮询确认接纳即清旧草稿，迟到完成不清后来输入", async ui => {
  await ui.change("待接纳提示"); await ui.submit(); ui.accept("a", false); await ui.poll();
  assert.equal(ui.textarea().props.value, "");
  await ui.change("接纳后的新草稿"); await ui.finish();
  assert.equal(ui.textarea().props.value, "接纳后的新草稿");
});
await check("接纳前已编辑新草稿，停止及随后断流都应保留", async ui => {
  await ui.change("发送的旧提示"); await ui.submit(); await ui.change("停止前的新草稿");
  ui.accept("a", false); await ui.stop(); assert.equal(ui.textarea().props.value, "停止前的新草稿");
  await ui.finish("a", true); assert.equal(ui.textarea().props.value, "停止前的新草稿");
});
await check("切走后A断流，返回A核对接纳并清旧草稿，B草稿保留", async ui => {
  await ui.change("A断流提示"); await ui.submit(); ui.accept("a", false);
  await ui.select("b"); await ui.change("B新草稿"); await ui.finish("a", true);
  assert.equal(ui.textarea().props.value, "B新草稿"); await ui.select("a"); assert.equal(ui.textarea().props.value, "");
  await ui.select("b"); assert.equal(ui.textarea().props.value, "B新草稿");
});
console.error = originalError;
console.log(`结果：${pass} 通过，${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
