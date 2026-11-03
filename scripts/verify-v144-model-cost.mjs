// #06 与 #07 共用隔离供应商替身，不访问官方 API。
import { withModelProvider } from "./verify-model-provider-fixture.mjs";
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
process.env.AI_MODE="replay";
const result=await withModelProvider(async (url,stats) => {
 const result=await runIsolatedReplay({slug:"model-cost",title:"官方模型成本计量（隔离替身，真实 LLM 成本为零）",scenarioScript:"scripts/verify-v144-model-cost-scenario.mjs",designatedAdmin:true,seedLegacyAuth:true,providerFixtureUrl:url,expectedWorkflows:5});
 await writeFile(join(result.outputDir,"provider-summary.json"),JSON.stringify({fixture:true,live:false,realLlmCostCny:"0",...stats()},null,2));
 return result;
});
process.exit(result?.fail>0||!result?1:0);
