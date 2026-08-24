// v1.2 综合固定回放验证入口：只编排专项脚本并汇总退出码，不复制业务断言。
// 用法：AI_MODE=replay node scripts/verify-v12-replay.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aiMode = process.env.AI_MODE ?? "replay";
const baseUrl = process.env.VERIFY_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:3000";
const suites = [
  ["安全", "Markdown 安全渲染", "verify-markdown-safety.mjs"],
  ["冻结与协议", "显式冻结两阶段协议", "verify-explicit-freeze-protocol.mjs"],
  ["冻结与协议", "跨 Agent 协议安全网", "verify-protocols.mjs"],
  ["生命周期", "级联删除与补偿", "verify-cascade-delete.mjs"],
  ["消息事实源与恢复", "消息事实源与生成恢复", "verify-message-recovery.mjs"],
  ["消息事实源与恢复", "消息级文件来源", "verify-message-file-provenance.mjs"],
  ["并发与命名", "标签页并发与幂等", "verify-tab-concurrency.mjs"],
  ["并发与命名", "条件自动命名", "verify-conditional-auto-naming.mjs"],
  ["项目与文件边界", "项目边界隔离", "verify-project-boundary.mjs"],
  ["项目与文件边界", "文件协议与 HTML 快照", "verify-file-protocol-snapshots.mjs"],
  ["tickets 交付", "tickets 版本交付", "verify-ticket-version-delivery.mjs"],
];
if (aiMode !== "replay") {
  console.error("❌ 综合回放只允许 AI_MODE=replay，拒绝切换到真实模型");
  process.exit(1);
}
function counts(output) {
  const matches = [...output.matchAll(/结果:[^0-9]*([0-9]+)[^0-9]+([0-9]+)[^失败]*失败/g)];
  if (!matches.length) return null;
  return { pass: Number(matches.at(-1)[1]), fail: Number(matches.at(-1)[2]) };
}
function summary(output) {
  const lines = output.split(String.fromCharCode(10)).filter((line) => line.includes("❌") || line.includes("结果:"));
  return (lines.length ? lines : output.split(String.fromCharCode(10)).filter(Boolean).slice(-8)).slice(-8).join(String.fromCharCode(10)).slice(0, 2000) || "专项没有输出可定位摘要";
}
function runSuite(category, name, file) {
  const script = path.join(ROOT, "scripts", file);
  if (!fs.existsSync(script)) return Promise.resolve({ category, name, file, code: 1, output: "缺少专项脚本 " + file });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      env: { ...process.env, AI_MODE: "replay", VERIFY_BASE_URL: baseUrl, BASE_URL: baseUrl, CASCADE_DELETE_TEST_HOOKS: "1", AUTO_NAME_TEST_HOOKS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const onData = (chunk, stream) => { const text = chunk.toString(); output += text; stream.write(text); };
    child.stdout.on("data", (chunk) => onData(chunk, process.stdout));
    child.stderr.on("data", (chunk) => onData(chunk, process.stderr));
    child.once("error", (error) => resolve({ category, name, file, code: 1, output: output + error.message }));
    child.once("close", (code, signal) => resolve({ category, name, file, code: code ?? 1, signal, output }));
  });
}
async function assertReplayServer() {
  const response = await fetch(baseUrl + "/api/verify/replay-mode", { cache: "no-store" });
  if (!response.ok) throw new Error("服务端未提供 replay 状态（HTTP " + response.status + "）");
  const body = await response.json();
  if (body.aiMode !== "replay") throw new Error("服务端不是 AI_MODE=replay，未运行专项");
}
console.log("v1.2 综合固定回放验证（AI_MODE=replay）");
try {
  await assertReplayServer();
  console.log("✅ 服务端已确认 AI_MODE=replay");
} catch (error) {
  console.error("❌ " + (error.message || error));
  console.log("综合结果: 0 个专项通过, 0 个专项失败, " + suites.length + " 个专项未运行（环境阻塞）");
  process.exit(1);
}
const results = [];
for (const [category, name, file] of suites) {
  console.log("\n── [" + category + "] " + name + " ──");
  results.push(await runSuite(category, name, file));
}
let suitePass = 0;
let suiteFail = 0;
let assertionPass = 0;
let assertionFail = 0;
console.log("\n专项汇总：");
for (const result of results) {
  const parsed = counts(result.output);
  const ok = result.code === 0;
  if (ok) suitePass += 1; else suiteFail += 1;
  if (parsed) { assertionPass += parsed.pass; assertionFail += parsed.fail; }
  console.log((ok ? "✅" : "❌") + " [" + result.category + "] " + result.name + ": " + (ok ? "通过" : "失败") + (parsed ? "，断言 " + parsed.pass + " 通过 / " + parsed.fail + " 失败" : "，未解析到断言汇总"));
  if (!ok) console.log("  定位摘要：\n" + summary(result.output));
}
console.log("\n综合结果: " + suitePass + " 个专项通过, " + suiteFail + " 个专项失败；断言 " + assertionPass + " 通过, " + assertionFail + " 失败");
process.exit(suiteFail > 0 ? 1 : 0);
