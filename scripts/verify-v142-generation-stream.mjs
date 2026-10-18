// v1.42 长生成流式响应专项；仅固定回放，不发起真实模型调用。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";

const result = await runIsolatedReplay({
  slug: "generation-stream",
  title: "v1.42 长生成流式响应",
  scenarioScript: "scripts/verify-v142-generation-stream-scenario.mjs",
  expectedWorkflows: 6,
});
process.exit(result.fail > 0 ? 1 : 0);
