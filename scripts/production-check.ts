import mysql from "mysql2/promise";
import { productionConfigurationErrors } from "../src/lib/production-config";
import { getMysqlAppConfig, getMysqlConnectionOptions } from "../src/lib/mysql-config";
import { checkProductionDatabase, recoverProductionGenerations } from "../src/lib/mysql-production-recovery";
import { explicitProductionEnv } from "./production-env";
import { existsSync } from "node:fs";

async function main() {
  const env = explicitProductionEnv();
  const errors = productionConfigurationErrors(env);
  if (process.argv.includes("--recover") && [".env", ".env.local", ".env.production", ".env.production.local"].some(existsSync)) errors.push("部署目录中不可遗留 .env 文件；生产配置只通过仓库外 EnvironmentFile 注入");
  if (Number(process.versions.node.split(".")[0]) !== 24) errors.push("当前部署路线使用 Node.js 24 LTS");
  for (const error of errors) console.error(`❌ ${error}`);
  if (errors.length) { process.exitCode = 1; return; }
  console.log("✅ 生产配置离线检查通过（不代表服务器或真实模型已验收）");
  if (!process.argv.includes("--database") && !process.argv.includes("--recover")) return;
  const pool = mysql.createPool(getMysqlConnectionOptions(getMysqlAppConfig(env)));
  try {
    await checkProductionDatabase(pool);
    console.log("✅ 数据库版本与迁移检查通过");
    if (process.argv.includes("--recover")) {
      if (env.IDEASTAGE_SINGLE_INSTANCE !== "1") throw new Error("恢复仅允许已停旧实例的 IDEASTAGE_SINGLE_INSTANCE=1 部署");
      const result = await recoverProductionGenerations(pool);
      console.log(`✅ 重启恢复：新工作台 ${result.iteration} 条，旧会话 ${result.legacy} 条`);
    }
  } finally { await pool.end(); }
}
main().catch(() => { console.error("❌ 生产检查失败；检查数据库可达性、权限、版本与迁移；恢复操作须先停止旧实例。"); process.exitCode = 1; });
