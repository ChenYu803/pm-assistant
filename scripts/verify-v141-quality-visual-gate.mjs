// v1.41 #23：逐项保留结果，任何专项失败或资源清理失败都不能被总计掩盖。
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";

const visualOnly = process.argv.includes("--visual-only");
if (process.argv.slice(2).some((arg) => arg !== "--visual-only")) throw new Error("只支持 --visual-only；完整质量闸无需参数");
const suites = [
  { ticket:19,slug:"replay-foundation",title:"基础回放",scenarioScript:"scripts/verify-v141-replay-foundation-scenario.mjs" },
  { ticket:20,slug:"file-context-replay",title:"文件与上下文回放",scenarioScript:"scripts/verify-v141-file-context-replay-scenario.mjs",captureProvider:true },
  { ticket:21,slug:"task-permission-replay",title:"任务与权限回放",scenarioScript:"scripts/verify-v141-task-permission-replay-scenario.mjs",captureProvider:true },
  { ticket:22,slug:"deletion-failure-replay",title:"删除与故障回放",scenarioScript:"scripts/verify-v141-deletion-failure-replay-scenario.mjs" },
  { ticket:23,slug:"quality-visual",title:"质量与视觉",scenarioScript:"scripts/verify-v141-quality-visual-scenario.mjs" },
].filter((suite) => !visualOnly || suite.ticket === 23);
const startedAt = new Date().toISOString();
const evidenceRoot = resolve(visualOnly ? ".scratch/screenshots/v141-quality-draft" : "docs/verification/v141-quality");
await mkdir(evidenceRoot, { recursive:true });
async function filesUnder(dir) {
  const entries = await readdir(dir,{ withFileTypes:true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]))).flat();
}
const sourceFiles = [...await filesUnder("src"),...suites.map((suite) => suite.scenarioScript),"scripts/verify-v141-isolated-replay.mjs","scripts/verify-v141-quality-visual-gate.mjs","scripts/verify-v141-markdown-progress.mjs","next.config.ts","postcss.config.mjs","package.json","package-lock.json","tsconfig.json"].sort();
async function fingerprints() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file,createHash("sha256").update(await readFile(file)).digest("hex")])));
}
const sourceSha256 = await fingerprints();
const report = { startedAt,completedAt:null,kind:visualOnly ? "visual-draft" : "quality-gate",aiMode:"replay",node:process.version,platform:process.platform,sourceSha256,suites:[],pass:0,fail:0 };
// 渲染器未通过有界回归时，拒绝进入可能冻结浏览器的后续检查。
const markdown = spawnSync(process.execPath,["--import","tsx","scripts/verify-v141-markdown-progress.mjs"],{ encoding:"utf8",timeout:30000,windowsHide:true });
try {
  report.markdownProgress = JSON.parse(await readFile(".scratch/screenshots/quality-markdown-progress-result.json","utf8"));
  report.markdownProgress.okay = !markdown.error && markdown.status === 0 && report.markdownProgress.pass > 0 && report.markdownProgress.fail === 0;
} catch { report.markdownProgress = { pass:0,fail:1,okay:false }; }
await writeFile(join(evidenceRoot,"markdown-progress.json"),JSON.stringify(report.markdownProgress,null,2));
if (!report.markdownProgress.okay) {
  report.fail = Math.max(1,report.markdownProgress.fail); report.okay = false; report.completedAt = new Date().toISOString();
  await writeFile(join(evidenceRoot,"summary.json"),JSON.stringify(report,null,2));
  console.error("❌ Markdown 回归未通过，不启动浏览器或测试数据库"); process.exit(1);
}
console.log(`✅ Markdown 有界回归 ${report.markdownProgress.pass}/${report.markdownProgress.pass}；随后运行隔离浏览器专项。`);
for (const suite of suites) {
  console.log(`开始 #${suite.ticket} ${suite.title}；串行运行，每项使用自己的独立空库。`);
  const previousHook = process.env.CASCADE_DELETE_TEST_HOOKS;
  if (suite.ticket === 22) process.env.CASCADE_DELETE_TEST_HOOKS = "1";
  const begin = Date.now();
  try {
    const result = await runIsolatedReplay(suite);
    const evidence = { ticket:suite.ticket,slug:suite.slug,...result,seconds:Number(((Date.now()-begin)/1000).toFixed(1)),scenario:null,environment:null,evidenceErrors:[] };
    // 全部截图和已脱敏日志另存工作区，不依赖操作系统临时目录的寿命。
    const archive = resolve(".scratch/screenshots/v141-quality-raw",`${suite.ticket}-${suite.slug}`);
    await cp(result.outputDir,archive,{ recursive:true });
    evidence.archive = archive;
    // 原始断言和初始化结果留在仓库，临时日志路径保留供深入定位。
    for (const [filename,key] of [["scenario-summary.json","scenario"],["empty-database.json","environment"]]) {
      try { evidence[key] = JSON.parse(await readFile(join(result.outputDir,filename),"utf8")); }
      catch (error) { evidence.evidenceErrors.push(`${filename}：${error.code ?? error.message}`); }
    }
    const screenshotPaths = [];
    if (suite.ticket === 23 && evidence.scenario) {
      const imageDir = join(evidenceRoot,"screenshots"); await mkdir(imageDir,{ recursive:true });
      for (const path of evidence.scenario.screenshots) {
        const target = join(imageDir,basename(path)); await cp(path,target);
        screenshotPaths.push(`screenshots/${basename(path)}`);
      }
      for (const file of ["visual-geometry.json","visual-contrast.json","visual-touch-targets.json"]) {
        try { await cp(join(result.outputDir,file),join(evidenceRoot,file)); }
        catch (error) { evidence.evidenceErrors.push(`${file}：${error.code ?? error.message}`); }
      }
    }
    evidence.screenshots = screenshotPaths;
    evidence.okay = result.fail === 0 && result.pass > 0 && result.cleaned && evidence.evidenceErrors.length === 0 && evidence.scenario?.fail === 0 && evidence.scenario?.aiMode === "replay" && evidence.scenario?.workflows?.length === 2;
    report.pass += result.pass;
    report.fail += result.fail + (evidence.okay ? 0 : result.fail === 0 ? 1 : 0);
    const filename = `${suite.ticket}-${suite.slug}.json`;
    await writeFile(join(evidenceRoot,filename),JSON.stringify(evidence,null,2));
    report.suites.push({ ticket:suite.ticket,okay:evidence.okay,pass:result.pass,fail:result.fail,cleaned:result.cleaned,seconds:evidence.seconds,evidence:filename,outputDir:result.outputDir });
    console.log(`${evidence.okay ? "✅" : "❌"} #${suite.ticket} ${result.pass} 通过，${result.fail} 失败；证据：${join(evidenceRoot,filename)}`);
  } finally {
    if (previousHook === undefined) delete process.env.CASCADE_DELETE_TEST_HOOKS;
    else process.env.CASCADE_DELETE_TEST_HOOKS = previousHook;
  }
  // 每项结束即保存，不因后面的故障丢失已完成或失败的结果。
  await writeFile(join(evidenceRoot,"summary.json"),JSON.stringify(report,null,2));
}
const finalSha256 = await fingerprints();
if (JSON.stringify(finalSha256) !== JSON.stringify(sourceSha256)) { report.fail++; report.sourceChangedDuringRun = true; console.error("❌ 回放期间正式源码改变，不能认定同一版本通过"); }
report.completedAt = new Date().toISOString();
report.okay = report.fail === 0 && report.suites.length === suites.length && report.suites.every((suite) => suite.okay);
await writeFile(join(evidenceRoot,"summary.json"),JSON.stringify(report,null,2));
console.log(`结果: ${report.pass} 通过, ${report.fail} 失败；${visualOnly ? "仅视觉预检，不代表完整质量闸" : "19—23 专项质量闸"}：${evidenceRoot}`);
process.exit(report.okay ? 0 : 1);
