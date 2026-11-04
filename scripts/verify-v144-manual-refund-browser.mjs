// v1.44 #12：浏览器专项入口；独立库、端口、构建副本与本机邮件替身。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
process.env.AI_MODE = "replay";

const result = await runIsolatedReplay({
  slug: "manual-refund-browser", title: "人工退款浏览器 1440/390 专项",
  scenarioScript: "scripts/verify-v144-manual-refund-browser-scenario.mjs",
  designatedAdmin: true, manualRefundLifecycle: true, creditLifecycle: true,
  expectedWorkflows: 4,
});
const scenario = JSON.parse(await readFile(join(result.outputDir, "scenario-summary.json"), "utf8").catch(() => "{}"));
await writeFile(join(result.outputDir, "browser-qa.md"), [
  "# v1.44 #12 人工退款浏览器验证", "",
  "实际日期（Asia/Shanghai）：" + new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date()),
  "结果：" + (result.fail ? "失败" : "通过") + "；场景 " + (scenario.pass ?? 0) + " 通过 / " + (scenario.fail ?? 0) + " 失败；runner " + result.pass + " 通过 / " + result.fail + " 失败。",
  "隔离资源 cleaned=" + result.cleaned + "；真实资金=0；真实模型调用=0。",
  "命令：node --import tsx scripts/verify-v144-manual-refund-browser.mjs",
  "覆盖：1440×1000、390×844；真实 UI 发起；提交后丢响应、500、缺来源200的原操作持久保留；旧 mark-failed 草稿在 succeeded/held 后显式核对并转 complete；用户完整凭据与余额；整页溢出、局部表格滚动和页面异常。",
  "故障仅走 runner 隔离 IPC；旧未知草稿通过 sessionStorage 注入，不伪造服务端状态。",
  "浏览器执行路径：" + (scenario.browserExecutable ?? "启动失败"),
  "源码快照及运行时间：source-snapshot.json；断言与请求：scenario-summary.json；截图：screenshots 字段。",
  "workflows：" + JSON.stringify(scenario.workflows ?? []),
  "失败：" + JSON.stringify((scenario.assertions ?? []).filter(item => !item.okay)), "",
].join("\n"));
process.exitCode = result.fail > 0 ? 1 : 0;
