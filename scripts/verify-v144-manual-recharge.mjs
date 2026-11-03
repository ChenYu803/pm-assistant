// v1.44 #11：HTTP 与浏览器边界，随机隔离库，无真实转账或供应商调用。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
process.env.AI_MODE = "replay";
const result = await runIsolatedReplay({ slug:"manual-recharge", title:"联系充值与人工入账", scenarioScript:"scripts/verify-v144-manual-recharge-scenario.mjs", designatedAdmin:true, creditLifecycle:true, manualRechargeLifecycle:true, expectedWorkflows:5 });
process.exit(result.fail > 0 ? 1 : 0);
