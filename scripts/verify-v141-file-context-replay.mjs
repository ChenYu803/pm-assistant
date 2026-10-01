// v1.41 #20：独立空库内验证普通文件交付和手动上下文，固定使用 replay。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
const result = await runIsolatedReplay({
  slug: "file-context-replay", title: "文件与上下文回放",
  scenarioScript: "scripts/verify-v141-file-context-replay-scenario.mjs",
  captureProvider: true,
});
process.exit(result.fail > 0 ? 1 : 0);
