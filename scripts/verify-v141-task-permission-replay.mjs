// v1.41 #21：任务集合、一次撤回与权限边界；独立空库、正式 UI，固定 replay。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
const result = await runIsolatedReplay({
  slug: "task-permission-replay", title: "任务与权限回放",
  scenarioScript: "scripts/verify-v141-task-permission-replay-scenario.mjs",
  captureProvider: true,
});
process.exit(result.fail > 0 ? 1 : 0);
