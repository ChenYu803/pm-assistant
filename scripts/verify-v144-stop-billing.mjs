// #09 停止与故障结算 L2 隔离专项：独立 MySQL、正式应用、本机 HTTP 供应商。
import { withModelProvider } from "./verify-model-provider-fixture.mjs";
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
process.env.AI_MODE="replay";
const selectedWorkflows=[...new Set((process.env.V144_STOP_BILLING_WORKFLOWS??process.env.V144_STOP_BILLING_WORKFLOW??"").split(",").map(name=>name.trim()).filter(Boolean))];
const selectableWorkflows=["browser-stop-and-responsive-fees","processing-stop-regressions","stop-delayed-usage","polish-stop-reliable-usage","stop-usage-missing-and-disconnect","stop-usage-timeout","stop-usage-provider-failure"];
if(selectedWorkflows.some(name=>!selectableWorkflows.includes(name)))throw Error("未知停止计费专项分组");
const result=await withModelProvider(async(url,stats)=>{
 const result=await runIsolatedReplay({slug:"stop-billing",title:"停止与故障结算（隔离替身，真实费用为零）",scenarioScript:"scripts/verify-v144-stop-billing-scenario.mjs",designatedAdmin:true,seedLegacyAuth:true,providerFixtureUrl:url,expectedWorkflows:selectedWorkflows.length||15,creditLifecycle:true,stopBillingFaults:true});
 await writeFile(join(result.outputDir,"provider-summary.json"),JSON.stringify({fixture:true,live:false,realLlmCostCny:"0",...stats()},null,2));
 return result;
});
process.exit(result?.fail>0||!result?1:0);
