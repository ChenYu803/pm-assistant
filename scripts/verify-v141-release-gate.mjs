// v1.41 #24：最终发布闸；静态构建、专项证据和空库连续旅程缺一不可。
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import nextEnv from "@next/env";
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";

if (process.argv.length > 2) throw new Error("最终发布闸不接受跳过检查的参数");
nextEnv.loadEnvConfig(process.cwd());
const startedAt = new Date().toISOString();
const runId = startedAt.replace(/[:.]/g, "-");
// 每轮保留独立证据；失败后重试不会覆盖原始失败记录。
const evidenceRoot = resolve("docs/verification/v141-release", runId);
await mkdir(evidenceRoot, { recursive: true });
const report = {
  ticket: 24, startedAt, completedAt: null, aiMode: process.env.AI_MODE,
  node: process.version, platform: process.platform, okay: false,
  decision: "尚未通过，不发布", checks: [], staticChecks: [],
  sourceSha256: {}, quality: null, replay: null, errors: [],
};
const requiredCheckpoints = ["registration-login", "two-iteration-goals",
  "four-stage-navigation-status", "multi-session-isolation-stop", "manual-context-provider",
  "ordinary-create-overwrite-rollback", "html-markdown", "revisions-undo-rename-delete",
  "task-set-atomic-submit-undo-sequence", "permission-isolation",
  "session-iteration-delete-failures", "deleted-source-readonly", "project-cascade-rollback"];

async function save() {
  await writeFile(join(evidenceRoot, "summary.json"), JSON.stringify(report, null, 2));
}
async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory()
    ? filesUnder(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]))).flat();
}
const sourceFiles = [...await filesUnder("src"), ...await filesUnder("public"),
  "next.config.ts", "postcss.config.mjs", "package.json", "package-lock.json", "tsconfig.json",
  "scripts/verify-v141-isolated-replay.mjs", "scripts/verify-v141-replay-foundation-server.mjs",
  "scripts/verify-v141-release-gate.mjs", "scripts/verify-v141-release-gate-scenario.mjs",
  "scripts/verify-v141-markdown-progress.mjs",
].sort();
async function fingerprints() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file,
    createHash("sha256").update(await readFile(file)).digest("hex")])));
}
function check(name, condition) {
  report.checks.push({ name, okay: !!condition });
  if (!condition) throw new Error(name);
  console.log(`✅ ${name}`);
}
async function runCheck(name, args, timeout) {
  const begin = Date.now();
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8", timeout, windowsHide: true,
    env: { ...process.env, AI_MODE: "replay", NEXT_TELEMETRY_DISABLED: "1" },
  });
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  await writeFile(join(evidenceRoot, `${name}.log`), log);
  const record = { name, command: ["node", ...args], exitCode: result.status,
    okay: !result.error && result.status === 0,
    seconds: Number(((Date.now() - begin) / 1000).toFixed(1)),
    error: result.error?.message ?? null, log: `${name}.log` };
  report.staticChecks.push(record);
  await save();
  check(`${name} 通过`, record.okay);
}

try {
  check("发布入口明确使用 replay", process.env.AI_MODE === "replay");
  report.sourceSha256 = await fingerprints();
  // 23 号汇总保留环境恢复历史；逐项验证，不凭总计认定专项全部通过。
  const qualityPath = "docs/verification/v141-quality/summary.json";
  const quality = JSON.parse(await readFile(qualityPath, "utf8"));
  const packageBeforeEntry = (await readFile("package.json", "utf8"))
    .replace(/^    "verify:v141-release-gate":.*\r?\n/m, "");
  check("相比专项证据仅新增本票 npm 入口", createHash("sha256")
    .update(packageBeforeEntry).digest("hex") === quality.sourceSha256?.["package.json"]);
  check("23 号最终质量证据完整且为 replay", quality.okay === true && quality.fail === 0
    && quality.aiMode === "replay" && quality.kind === "quality-gate"
    && quality.suites?.length === 5 && quality.markdownProgress?.okay === true);
  const qualityEvidence = [];
  for (const ticket of [19, 20, 21, 22, 23]) {
    const suite = quality.suites.find((item) => item.ticket === ticket);
    check(`${ticket} 号专项有通过与清理事实`, suite?.okay === true
      && suite.pass > 0 && suite.fail === 0 && suite.cleaned === true);
    const evidence = JSON.parse(await readFile(join("docs/verification/v141-quality", suite.evidence), "utf8"));
    check(`${ticket} 号原始证据支持摘要`, evidence.okay === true && evidence.fail === 0
      && evidence.scenario?.fail === 0 && evidence.scenario.aiMode === "replay"
      && evidence.scenario.workflows?.length === 2
      && evidence.scenario.assertions?.length === evidence.scenario.pass
      && evidence.scenario.assertions.every((assertion) => assertion.okay === true)
      && Object.keys(evidence.environment?.initialCounts ?? {}).length > 0
      && Object.values(evidence.environment.initialCounts).every((count) => count === 0));
    qualityEvidence.push({ ...suite, evidenceSha256: createHash("sha256")
      .update(await readFile(join("docs/verification/v141-quality", suite.evidence))).digest("hex") });
  }
  // 新 npm 入口改变 package.json 的脚本，应用与既有验证源码仍须逐字节相同。
  const comparable = Object.entries(quality.sourceSha256 ?? {}).filter(([file]) => file !== "package.json");
  const changed = [];
  for (const [file, digest] of comparable) {
    if (createHash("sha256").update(await readFile(file)).digest("hex") !== digest) changed.push(file);
  }
  check("既有专项与视觉验收对应当前正式源码", comparable.length > 0
    && comparable.some(([file]) => file === "src/components/ProductIterationWorkbench.tsx")
    && sourceFiles.filter((file) => file.startsWith("src/"))
      .every((file) => quality.sourceSha256?.[file])
    && changed.length === 0);
  report.quality = { evidence: qualityPath, pass: quality.pass, fail: quality.fail,
    summarySha256: createHash("sha256").update(await readFile(qualityPath)).digest("hex"),
    suites: qualityEvidence, unchangedInputs: comparable.length,
    changedInputs: changed, note: "引用同源码专项，另执行本票完整连续回放；不把专项串跑当连续回放" };

  // 构建必须先结束；Next build 会清理 .next 下隔离应用，不能并发执行。
  await runCheck("typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], 120_000);
  await runCheck("lint", ["node_modules/eslint/bin/eslint.js"], 120_000);
  await runCheck("build", ["node_modules/next/dist/bin/next", "build"], 240_000);
  await runCheck("markdown-progress", ["--import", "tsx", "scripts/verify-v141-markdown-progress.mjs"], 30_000);
  await runCheck("scenario-syntax", ["--check", "scripts/verify-v141-release-gate-scenario.mjs"], 30_000);
  check("构建未改变待验收输入", JSON.stringify(await fingerprints()) === JSON.stringify(report.sourceSha256));

  const previousHook = process.env.CASCADE_DELETE_TEST_HOOKS;
  const begin = Date.now();
  let result;
  try {
    process.env.CASCADE_DELETE_TEST_HOOKS = "1";
    result = await runIsolatedReplay({ slug: "release-gate", title: "最终连续发布回放",
      scenarioScript: "scripts/verify-v141-release-gate-scenario.mjs", captureProvider: true });
  } finally {
    if (previousHook === undefined) delete process.env.CASCADE_DELETE_TEST_HOOKS;
    else process.env.CASCADE_DELETE_TEST_HOOKS = previousHook;
  }
  report.replay = { ...result, seconds: Number(((Date.now() - begin) / 1000).toFixed(1)) };
  // 已脱敏的原始日志保存在工作区，永久断言与截图另入仓库。
  const archive = resolve(".scratch/screenshots/v141-release-raw", runId);
  await cp(result.outputDir, archive, { recursive: true });
  report.replay.archive = archive;
  for (const name of ["scenario-summary.json", "empty-database.json", "provider-observation.json",
    "provider-evidence.json", "permission-matrix.json", "failure-facts.json", "geometry.json"]) {
    await cp(join(result.outputDir, name), join(evidenceRoot, name));
  }
  const environment = JSON.parse(await readFile(join(result.outputDir, "empty-database.json"), "utf8"));
  check("本轮数据库初始化证据来自当前随机空库", environment.database === result.database
    && Object.keys(environment.initialCounts ?? {}).length > 0
    && Object.values(environment.initialCounts).every((count) => count === 0));
  const scenario = JSON.parse(await readFile(join(result.outputDir, "scenario-summary.json"), "utf8"));
  report.replay.scenario = scenario;
  const imageDir = join(evidenceRoot, "screenshots");
  await mkdir(imageDir);
  for (const path of scenario.screenshots ?? []) await cp(path, join(imageDir, basename(path)));
  check("完整连续旅程与空库清理通过", result.pass > 0 && result.fail === 0 && result.cleaned
    && scenario.aiMode === "replay" && scenario.fail === 0 && scenario.workflows?.length === 2
    && scenario.assertions?.length === scenario.pass
    && scenario.assertions.every((assertion) => assertion.okay === true));
  check("桌面与移动沿各自同一账号和项目完成全部旅程", scenario.journeys?.length === 2
    && scenario.journeys.every((journey) => journey.completed === true && journey.email
      && requiredCheckpoints.every((checkpoint) => journey.checkpoints?.includes(checkpoint))
      && journey.events?.length > 0
      && journey.events.every((event) => event.projectId === journey.projectId)
      && scenario.workflows.some((workflow) => workflow.projectId === journey.projectId
        && workflow.viewport.width === journey.viewport.width)));
  const geometry = JSON.parse(await readFile(join(result.outputDir, "geometry.json"), "utf8"));
  check("每个视口都有本轮截图和操作边界证据", scenario.screenshots?.length >= 2
    && scenario.workflows.every((workflow) => geometry.some((item) =>
      item.viewport.width === workflow.viewport.width && item.controls.length > 0)
      && scenario.screenshots.some((path) => basename(path).startsWith(`release-${workflow.viewport.width}-`))));
  check("发布回放期间源码保持不变", JSON.stringify(await fingerprints()) === JSON.stringify(report.sourceSha256));
  report.okay = true;
  report.decision = "v1.41 MySQL/replay 发布闸通过；真实模型与外部部署不在本次验收范围";
} catch (error) {
  report.errors.push(error.message);
  console.error(`❌ 最终发布闸未通过：${error.message}`);
} finally {
  report.completedAt = new Date().toISOString();
  await save();
}
console.log(`结果: ${report.checks.filter((item) => item.okay).length} 通过, ${report.errors.length} 失败；${report.decision}；证据：${evidenceRoot}`);
process.exit(report.okay ? 0 : 1);
