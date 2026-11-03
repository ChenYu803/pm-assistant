// v1.44 #05：正式 HTTP / 浏览器与隔离 MySQL，无真实邮件或模型费用。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
process.env.AI_MODE = "replay";
const result = await runIsolatedReplay({ slug: "gift-invites", title: "赠送邀请码兑换", scenarioScript: "scripts/verify-v144-gift-invites-scenario.mjs", designatedAdmin: true, seedLegacyAuth: true, expectedWorkflows: 5 });
process.exit(result.fail > 0 ? 1 : 0);
