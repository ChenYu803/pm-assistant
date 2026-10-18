// 生产准备专项：随机隔离数据库、邀请码 UI 与持久恢复；不请求真实模型。
import { randomBytes } from "node:crypto";
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";

process.env.AI_MODE = "replay";
process.env.REGISTRATION_MODE = "invite";
process.env.REGISTRATION_INVITE_CODE = randomBytes(24).toString("hex");
const result = await runIsolatedReplay({
  slug: "production-preparation",
  title: "v1.42 生产准备",
  scenarioScript: "scripts/verify-v142-production-preparation-scenario.mjs",
  expectedWorkflows: 7,
});
process.exit(result.fail > 0 ? 1 : 0);
