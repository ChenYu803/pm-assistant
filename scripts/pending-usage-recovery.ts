// 独立单次恢复任务：生产由 systemd timer 调度；使用网站应用账号，不需要维护权限。
import { explicitProductionEnv } from "./production-env";
import { closeMysqlPoolForTests } from "../src/lib/mysql";
import { recoverPendingUsage } from "../src/lib/pending-usage-recovery";

async function main() {
  if (process.argv.includes("--env")) {
    const env = explicitProductionEnv();
    // 指定文件时必须完全采用文件配置，不能混入本机已有连接和测试时钟。
    for (const key of Object.keys(process.env)) {
      if (/^(MYSQL_|V144_|AI_|NODE_ENV$)/.test(key)) delete process.env[key];
    }
    Object.assign(process.env, env);
  }
  try {
    const result = await recoverPendingUsage();
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } finally { await closeMysqlPoolForTests(); }
}
main().catch(() => { console.error("pending_usage_recovery_unavailable"); process.exitCode = 1; });
