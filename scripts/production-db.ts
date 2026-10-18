import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { initializeMysql, migrateMysql } from "../src/lib/mysql-bootstrap";
import { explicitProductionEnv } from "./production-env";

async function main() {
  const env = explicitProductionEnv();
  const index = process.argv.indexOf("--maintenance");
  if (index < 0 || !process.argv[index + 1]) throw new Error();
  Object.assign(env, parseEnv(readFileSync(process.argv[index + 1], "utf8")));
  const action = process.argv.includes("--initialize") ? initializeMysql : migrateMysql;
  const result = await action(env);
  console.log(`✅ 数据库准备完成：MySQL ${result.serverVersion}，新增迁移 ${result.migrationApplied ? "是" : "否"}`);
}
main().catch(() => { console.error("❌ 数据库维护失败，请核对维护配置、版本、目标库与权限；未输出凭据。"); process.exitCode = 1; });
