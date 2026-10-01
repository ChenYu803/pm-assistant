// v1.41 #23：直接验证正式渲染器的半截 Markdown，子进程硬超时防止空转卡住验收。
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

if (process.argv[2] === "--render") {
  const [{ default:React }, { renderToStaticMarkup }, rendererModule] = await Promise.all([
    import("react"), import("react-dom/server"), import("../src/components/MarkdownRenderer.tsx"),
  ]);
  // 本机 tsx 的 CJS 互操作已实测为 default.default；原生 ESM 则直接导出组件函数。
  const Renderer = typeof rendererModule.default === "function" ? rendererModule.default : rendererModule.default?.default;
  if (typeof Renderer !== "function") throw new Error("正式 Markdown 渲染器没有导出组件函数");
  const content = Buffer.from(process.argv[3], "base64").toString("utf8");
  process.stdout.write(renderToStaticMarkup(React.createElement(Renderer, { content })));
  process.exit(0);
}

const timeoutMs = Number(process.env.V141_MARKDOWN_RENDER_TIMEOUT_MS ?? 2000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 2000) throw new Error("子进程硬超时只允许 1000—2000ms");
const fixtures = [
  ...["# ", "## ", "###### ", "___说明"].map((content) => ({
    name:`半截标记 ${JSON.stringify(content)} 在硬超时内保留为正文`, content,
    verify:(html) => html.includes(content),
  })),
  ...["---说明", "***说明"].map((content) => ({
    name:`已有无序列表边界 ${JSON.stringify(content)} 不空转且保留内容`, content,
    verify:(html) => html.includes("<ul") && html.includes("说明"),
  })),
  ...["1)", "1、"].map((content) => ({
    name:`已有有序列表边界 ${JSON.stringify(content)} 不空转且保留列表语义`, content,
    verify:(html) => html.includes("<ol") && html.includes("<li"),
  })),
  {
    name:"连续半截行后仍能渲染正式标题、列表和普通段落",
    content:"# \n## \n___说明\n# 正式标题\n- 清单项\n\n普通段落",
    verify:(html) => html.includes("# </p>") && html.includes("## </p>") && html.includes("___说明</p>") && /<h1[^>]*>正式标题<\/h1>/.test(html) && html.includes("<ul") && html.includes("清单项") && html.includes("普通段落</p>"),
  },
  {
    name:"兜底正文仍转义 HTML 并拒绝危险链接",
    content:'___<img src=x onerror="alert(1)"><script>alert(1)</script> [危险](javascript:alert)\n\n[安全](https://example.com)',
    verify:(html) => html.includes("&lt;img") && html.includes("&lt;script&gt;") && !/<(?:img|script)\b|<[^>]+\sonerror=|href="javascript:/.test(html) && html.includes('href="https://example.com"'),
  },
  {
    name:"未闭合代码围栏不空转且不会执行 HTML",
    content:"```typescript\n# 代码文本\n<script>文本</script>",
    verify:(html) => !/<script\b/.test(html),
  },
  {
    name:"空内容和空白行可以结束渲染",
    content:"\n \n\t\n", verify:(html) => !html.includes("<p") && !html.includes("<h1"),
  },
];
let pass = 0; let fail = 0; const assertions = [];
for (const fixture of fixtures) {
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--render", Buffer.from(fixture.content).toString("base64")], {
    encoding:"utf8", timeout:timeoutMs, killSignal:"SIGKILL", windowsHide:true, maxBuffer:1024 * 1024,
  });
  const timedOut = child.error?.code === "ETIMEDOUT";
  const okay = !child.error && child.status === 0 && fixture.verify(child.stdout);
  assertions.push({ name:fixture.name, okay, timedOut, timeoutMs, milliseconds:Date.now() - startedAt, status:child.status, error:child.error?.message ?? (child.status !== 0 ? child.stderr.trim() : undefined) });
  if (okay) { pass++; console.log(`✅ ${fixture.name}`); }
  else { fail++; console.error(`❌ ${fixture.name}${timedOut ? "：硬超时已终止空转" : ""}`); }
}
const evidencePath = ".scratch/screenshots/quality-markdown-progress-result.json";
await mkdir(".scratch/screenshots", { recursive:true });
await writeFile(evidencePath, JSON.stringify({ pass, fail, timeoutMs, assertions }, null, 2));
console.log(`结果: ${pass} 通过, ${fail} 失败；证据：${evidencePath}`);
process.exit(fail > 0 ? 1 : 0);
