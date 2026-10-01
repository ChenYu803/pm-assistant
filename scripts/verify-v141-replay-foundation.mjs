// v1.41 #19：从独立空库回放基础业务，环境管理由专项共享入口负责。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
const result = await runIsolatedReplay({
  slug: "replay-foundation", title: "基础回放",
  scenarioScript: "scripts/verify-v141-replay-foundation-scenario.mjs",
});
process.exit(result.fail > 0 ? 1 : 0);
