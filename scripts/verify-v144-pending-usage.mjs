// #10 L2：独立空库、正式应用、本机 HTTP 供应商；无真实模型费用。
import { withModelProvider } from "./verify-model-provider-fixture.mjs";
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
process.env.AI_MODE="replay";
const result=await withModelProvider(url=>runIsolatedReplay({slug:"pending-usage",title:"待核对自动恢复与到期（隔离替身）",scenarioScript:"scripts/verify-v144-pending-usage-scenario.mjs",providerFixtureUrl:url,designatedAdmin:true,expectedWorkflows:4,creditLifecycle:true,stopBillingFaults:true}));
process.exit(result?.fail>0||!result?1:0);
