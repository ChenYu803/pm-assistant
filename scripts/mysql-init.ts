import { loadEnvConfig } from "@next/env";

import { MysqlConfigurationError } from "@/lib/mysql-config";
import { initializeMysql } from "@/lib/mysql-bootstrap";

loadEnvConfig(process.cwd());

function diagnostic(error: unknown) {
  if (error instanceof MysqlConfigurationError) return error.message;
  const mysqlError = error as { code?: string; message?: string };
  switch (mysqlError.code) {
    case "ECONNREFUSED":
      return "无法连接 MySQL：服务可能未启动，或 MYSQL_HOST / MYSQL_PORT 配置错误";
    case "ER_ACCESS_DENIED_ERROR":
      return "MySQL 拒绝维护者账号：请检查 MYSQL_ADMIN_USER / MYSQL_ADMIN_PASSWORD 及其权限";
    case "ER_DBACCESS_DENIED_ERROR":
    case "ER_ACCESS_DENIED_NO_PASSWORD_ERROR":
      return "MySQL 权限不足：维护者账号需要创建项目数据库、账号和授权的权限";
    default:
      return mysqlError.message || "未知初始化错误";
  }
}

async function main() {
  try {
    const result = await initializeMysql();
    console.log(`✅ MySQL ${result.serverVersion} 初始化完成`);
    console.log(result.migrationApplied ? "✅ 已记录 bootstrap 迁移" : "✅ bootstrap 迁移已存在，无需重复执行");
    console.log("✅ 专用应用连接身份已验证（网站不使用 root）");
  } catch (error) {
    console.error(`❌ MySQL 初始化失败：${diagnostic(error)}`);
    process.exitCode = 1;
  }
}

void main();
