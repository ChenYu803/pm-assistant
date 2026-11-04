// v1.44 #13：只运行本版隔离专项及触及的相邻回归；live 与生产结论单列。
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const releaseSuites = [
  "v144-email-auth", "v144-email-unconfigured", "v144-auth-limits", "v144-auth-signout",
  "v144-admin-controls", "v144-admin-unconfigured", "v144-credits", "v144-gift-invites",
  "v144-local-session-naming", "v144-model-cost", "v144-conversation-credits",
  "v144-polish-credits", "v144-stop-billing", "v144-pending-usage", "v144-manual-recharge",
  "v144-manual-refund", "v144-manual-refund-browser", "v144-release-combination",
  "v141-replay-foundation", "v141-file-context-replay", "v141-task-permission-replay",
  "v141-deletion-failure-replay", "v142-generation-stream", "v142-production-preparation",
];

export async function runReleaseGate({ suites = releaseSuites, outputDir } = {}) {
  if (!suites.length || new Set(suites).size !== suites.length || suites.some(name => !releaseSuites.includes(name))) throw Error("拒绝空、重复或未知专项");
  if (Object.keys(process.env).some(name => /^(?:V144_.*(?:SMOKE|WORKFLOW)|V141_.*FILTER)$/.test(name) && process.env[name])) throw Error("完整发布回归拒绝继承局部筛选");
  outputDir ??= resolve("docs/verification/v144-release", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(outputDir, { recursive: true });
  const sourceFiles = execFileSync("git", ["ls-files", "src", "scripts", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json"], { encoding: "utf8" }).trim().split(/\r?\n/);
  // 工作区新增的发布脚本同样计入哈希，不能只记录 HEAD。
  for (const name of ["scripts/verify-v144-release-gate.mjs", "scripts/verify-v144-release-combination.mjs", "scripts/verify-v144-release-combination-scenario.mjs"]) if (!sourceFiles.includes(name)) sourceFiles.push(name);
  async function snapshot() {
    const result = {};
    for (const name of sourceFiles.sort()) result[name] = createHash("sha256").update(await readFile(name)).digest("hex");
    return result;
  }
  const before = await snapshot();
  const report = { boundary: "隔离 MySQL + 本机邮件/模型替身或 replay；无 live、目标机或生产资金证据", startedAt: new Date().toISOString(), head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), completeSuite: suites.length === releaseSuites.length, expectedSuites: suites, results: [], pass: 0, fail: 0, realLlmCostCny: "0", realFundsCny: "0", productionReadiness: "not-assessed" };
  await writeFile(join(outputDir, "source-before.json"), JSON.stringify(before, null, 2));
  for (const name of suites) {
    const logPath = join(outputDir, name + ".log");
    let log = "";
    console.log("开始 " + name);
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/verify-" + name + ".mjs"], { env: { ...process.env, AI_MODE: "replay" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { log += data.toString(); });
    // 每个 runner 自身有8分钟场景上限；父层不杀掉 runner，以便其 finally 清理隔离库。
    const exitCode = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
    await writeFile(logPath, log);
    const location = [...log.matchAll(/日志与截图：([^\r\n]+)/g)].at(-1)?.[1]?.trim();
    let summary;
    if (location) {
      try {
        summary = JSON.parse(await readFile(join(location, "summary.json"), "utf8"));
        if (resolve(summary.outputDir) !== resolve(location)) throw Error("摘要目录不匹配");
        for (const file of ["summary.json", "scenario-summary.json", "source-snapshot.json", "provider-summary.json"]) {
          try { await copyFile(join(location, file), join(outputDir, name + "-" + file)); }
          catch (error) { if (error.code !== "ENOENT") throw error; }
        }
      } catch { summary = undefined; }
    }
    const okay = exitCode === 0 && Number.isInteger(summary?.pass) && summary.pass > 0 && summary.fail === 0 && summary.cleaned === true;
    const row = { suite: name, exitCode, okay, pass: summary?.pass ?? 0, fail: summary?.fail ?? 1, cleaned: summary?.cleaned === true, evidenceDir: location ?? null };
    report.results.push(row); report.pass += row.pass; report.fail += okay ? 0 : Math.max(1, row.fail);
    await writeFile(join(outputDir, "summary.json"), JSON.stringify(report, null, 2));
    console.log((okay ? "✅ " : "❌ ") + name + "：" + row.pass + "/" + row.fail + "，cleaned=" + row.cleaned);
  }
  const after = await snapshot();
  report.sourceUnchanged = JSON.stringify(before) === JSON.stringify(after);
  if (!report.sourceUnchanged) report.fail++;
  report.endedAt = new Date().toISOString();
  report.isolatedPassed = report.completeSuite && report.fail === 0;
  await writeFile(join(outputDir, "source-after.json"), JSON.stringify(after, null, 2));
  await writeFile(join(outputDir, "summary.json"), JSON.stringify(report, null, 2));
  console.log("结果：" + report.pass + " 通过，" + report.fail + " 失败；发布状态仍需单独核对 live 与目标机证据；" + outputDir);
  return { ...report, outputDir };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runReleaseGate();
  process.exitCode = report.fail > 0 || !report.completeSuite ? 1 : 0;
}
