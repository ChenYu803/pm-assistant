// v1.41 #22：删除、归档与故障原子性专项，复用独立空库环境。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
// 只给本次隔离进程启用已有级联故障钩子，不修改日常服务。
process.env.CASCADE_DELETE_TEST_HOOKS = "1";
const result = await runIsolatedReplay({
  slug: "deletion-failure-replay", title: "删除与故障回放",
  scenarioScript: "scripts/verify-v141-deletion-failure-replay-scenario.mjs",
});
process.exit(result.fail > 0 ? 1 : 0);
