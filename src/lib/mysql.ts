import mysql, { type Pool } from "mysql2/promise";

import { getMysqlAppConfig } from "@/lib/mysql-config";

let pool: Pool | undefined;

/**
 * 应用账号连接的唯一入口，避免在路由中散落连接串或误用维护者账号。
 */
export function getMysqlPool(): Pool {
  if (!pool) {
    const config = getMysqlAppConfig();
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      waitForConnections: true,
      connectionLimit: 10,
      enableKeepAlive: true,
    });
  }
  return pool;
}

export async function closeMysqlPoolForTests() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/** 用户层统一使用这段提示，原始 MySQL 错误只写入服务端日志。 */
export function mysqlUnavailableMessage() {
  return "数据库暂时不可用，本次操作没有完成，请稍后手动重试。";
}
