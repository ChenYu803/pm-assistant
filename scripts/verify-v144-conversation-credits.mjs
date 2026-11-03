// 会话积分 L2 隔离专项：独立 MySQL、正式应用、本机 HTTP 供应商。
import { withModelProvider } from "./verify-model-provider-fixture.mjs";
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
process.env.AI_MODE="replay";
const result=await withModelProvider(async(url,stats)=>{
 const result=await runIsolatedReplay({slug:"conversation-credits",title:"会话预留与结算（隔离替身，真实费用为零）",scenarioScript:"scripts/verify-v144-conversation-credits-scenario.mjs",designatedAdmin:true,seedLegacyAuth:true,providerFixtureUrl:url,expectedWorkflows:4,creditLifecycle:true});
 await writeFile(join(result.outputDir,"provider-summary.json"),JSON.stringify({fixture:true,live:false,realLlmCostCny:"0",...stats()},null,2));
 return result;
});
process.exit(result?.fail>0||!result?1:0);
