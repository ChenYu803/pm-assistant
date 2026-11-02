import { loadEnvConfig } from "@next/env";

import { MysqlConfigurationError } from "@/lib/mysql-config";
import { migrateMysql } from "@/lib/mysql-bootstrap";

loadEnvConfig(process.cwd());

function diagnostic(error: unknown) {
  if (error instanceof MysqlConfigurationError) return error.message;
  const mysqlError = error as { code?: string; message?: string };
  switch (mysqlError.code) {
    case "ECONNREFUSED":
      return "无法连接 MySQL：请检查 MYSQL_HOST / MYSQL_PORT，以及云数据库是否允许应用访问";
    case "ER_ACCESS_DENIED_ERROR":
      return "应用账号无法登录或没有迁移权限：请在数据库控制台授予目标数据库的建表/改表权限";
    case "ER_BAD_DB_ERROR":
      return "目标数据库不存在：请先在云数据库控制台创建 MYSQL_DATABASE";
    default:
      return mysqlError.message || "未知迁移错误";
  }
}

async function main() {
  try {
    const result = await migrateMysql();
    console.log(`✅ MySQL ${result.serverVersion} 迁移完成`);
    console.log(result.migrationApplied ? "✅ 已应用新的数据库迁移" : "✅ 数据库已是最新，无需迁移");
  } catch (error) {
    console.error(`❌ MySQL 迁移失败：${diagnostic(error)}`);
    process.exitCode = 1;
  }
}

void main();
