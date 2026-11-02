// v1.44：用户登录额度与并发验证码额度，使用真实 HTTP 和随机隔离旧账号夹具。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
const result = await runIsolatedReplay({ slug: "auth-limits", title: "认证限流精确性", scenarioScript: "scripts/verify-v144-auth-limits-scenario.mjs", expectedWorkflows: 2, seedLegacyAuth: true });
process.exit(result.fail > 0 ? 1 : 0);