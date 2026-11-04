// v1.44 #12：正式 HTTP 人工退款 L2 专项；隔离空库与本机供应商，真实资金/LLM 为零。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
import { withModelProvider } from "./verify-model-provider-fixture.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const refundWorkflows = ["lifecycle", "permissions-validation", "idempotency", "identity-request", "transfer-failure", "internal-failure-restart", "response-loss", "pagination-query", "model-fraction", "model-exhausted", "model-protection", "concurrent-account"];
const filter = process.env.V144_REFUND_SMOKE === "1" ? ["lifecycle"] : process.env.V144_REFUND_WORKFLOW?.split(",").map(value => value.trim()).filter(Boolean) ?? refundWorkflows;
if (!filter.length || new Set(filter).size !== filter.length || filter.some(value => !refundWorkflows.includes(value))) throw new Error("退款 workflow 筛选为空、重复或未知，拒绝空跑成功");
process.env.V144_REFUND_WORKFLOW = filter.join(",");
process.env.AI_MODE = "replay";
const result = await withModelProvider(async (url, stats) => {
  const result = await runIsolatedReplay({ slug: "manual-refund", title: "人工退款完整 HTTP 专项", scenarioScript: "scripts/verify-v144-manual-refund-scenario.mjs", designatedAdmin: true, manualRefundLifecycle: true, creditLifecycle: true, providerFixtureUrl: url, expectedWorkflows: filter.length });
  await writeFile(join(result.outputDir, "provider-summary.json"), JSON.stringify({ fixture: true, live: false, realLlmCostCny: "0", realFunds: "0", ...stats() }, null, 2));
  const summary = JSON.parse(await readFile(join(result.outputDir, "scenario-summary.json"), "utf8").catch(() => "{}"));
  await writeFile(join(result.outputDir, "summary.md"), [
    "# v1.44 #12 人工退款 HTTP 验证", "",
    "本次真实运行：" + (result.fail ? "红灯" : "绿灯") + "。首次运行历史由执行者交接记录，不据脚本存在推断已完成 TDD。",
    "计数：" + result.pass + " pass / " + result.fail + " fail；场景 " + (summary.pass ?? 0) + " pass / " + (summary.fail ?? 0) + " fail。",
    "workflows：" + JSON.stringify(summary.workflows ?? []),
    "预期 workflows：" + filter.join(", "),
    "隔离 cleaned=" + result.cleaned + "；真实资金=0；真实 LLM 费用=0。",
    "命令：node --import tsx scripts/verify-v144-manual-refund.mjs（筛选环境 V144_REFUND_WORKFLOW=" + filter.join(",") + "）",
    "证据目录：" + result.outputDir,
    ...["scenario-summary.json", "scenario-progress.json", "scenario.log", "server.log", "provider-summary.json", "summary.json"].map(name => join(result.outputDir, name)),
    "范围：仅两个退款脚本与共享 runner 退款选项/第二管理员/隔离故障及账号锁 IPC；未改业务、UI、迁移、package、文档或 git。",
    "浏览器验证使用独立 npm run verify:v144-manual-refund-browser，证据见 docs/verification/v144-manual-refund.md；本报告仅汇总 HTTP 专项。",
    "失败：" + JSON.stringify((summary.assertions ?? []).filter(item => !item.okay)), ""
  ].join("\n"));
  return result;
});
process.exit(result.fail > 0 ? 1 : 0);
