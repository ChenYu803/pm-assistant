// v1.44 #02：隔离注册与找回全流程，不调用真实模型或真实邮件。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
const result = await runIsolatedReplay({ slug: "email-auth", title: "邮箱验证与密码找回", scenarioScript: "scripts/verify-v144-email-auth-scenario.mjs", expectedWorkflows: 1, seedLegacyAuth: true });
process.exit(result.fail > 0 ? 1 : 0);
