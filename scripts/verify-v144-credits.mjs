// v1.44 #04：正式 HTTP / 浏览器与隔离 MySQL，无真实供应商费用。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
process.env.AI_MODE = "replay";
const result = await runIsolatedReplay({ slug: "credits", title: "个人积分与管理调整", scenarioScript: "scripts/verify-v144-credits-scenario.mjs", designatedAdmin: true, seedLegacyAuth: true, creditLifecycle: true, expectedWorkflows: 5 });
process.exit(result.fail > 0 ? 1 : 0);
