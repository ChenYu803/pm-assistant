// 未配置邮件的正式路由验收：隔离空库，明确关闭邮件替身，不触达供应商。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
const result = await runIsolatedReplay({ slug: "email-unconfigured", title: "未配置邮件", scenarioScript: "scripts/verify-v144-email-unconfigured-scenario.mjs", expectedWorkflows: 1, emailBoundary: false });
process.exit(result.fail > 0 ? 1 : 0);
