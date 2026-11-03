// 未指定管理员时保持默认拒绝；只用本次隔离账号。
import { runIsolatedReplay } from "./verify-v141-isolated-replay.mjs";
const result = await runIsolatedReplay({ slug: "admin-unconfigured", title: "管理员未配置", scenarioScript: "scripts/verify-v144-admin-unconfigured-scenario.mjs", expectedWorkflows: 1 });
process.exit(result.fail > 0 ? 1 : 0);
