// #13：跨票组合使用独立空库和本机外部边界替身，不使用日常账号或资金。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
import { withModelProvider } from "./verify-model-provider-fixture.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
process.env.AI_MODE = "replay";
const result = await withModelProvider(async (url, stats) => {
  const result = await runIsolatedReplay({ slug: "release-combination", title: "发布跨票组合", scenarioScript: "scripts/verify-v144-release-combination-scenario.mjs", designatedAdmin: true, creditLifecycle: true, providerFixtureUrl: url, expectedWorkflows: 5 });
  await writeFile(join(result.outputDir, "provider-summary.json"), JSON.stringify({ fixture: true, live: false, realLlmCostCny: "0", ...stats() }, null, 2));
  return result;
});
process.exitCode = result.fail > 0 ? 1 : 0;
