// 随机隔离库中的退出登录专项；无模型请求。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
const result = await runIsolatedReplay({ slug: "auth-signout", title: "退出登录", scenarioScript: "scripts/verify-v144-auth-signout-scenario.mjs", expectedWorkflows: 1 });
process.exit(result.fail > 0 ? 1 : 0);
