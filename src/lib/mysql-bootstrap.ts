import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";

import {
  getMysqlAdminConfig,
  getMysqlAppConfig,
  type MysqlAdminConfig,
  type MysqlAppConfig,
} from "@/lib/mysql-config";

const BOOTSTRAP_MIGRATION = {
  id: "0001_mysql_bootstrap",
  checksum: "a5ab0ee5918634b01d8d00681f5f4f91f8e00cd074194d36ccbf2b6b9c4d56e5",
};

export interface MysqlInitializationResult {
  serverVersion: string;
  migrationApplied: boolean;
}

function quoteIdentifier(identifier: string) {
  return `\`${identifier.replaceAll("`", "``")}\``;
}

function quoteString(value: string) {
  return mysql.escape(value);
}

function accountName(config: MysqlAppConfig) {
  return `${quoteString(config.user)}@${quoteString(config.appHost)}`;
}

export function isAllowedApplicationGrant(grant: string, database: string) {
  const projectDml = `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO `;
  return (
    !grant.includes("WITH GRANT OPTION") &&
    (grant.startsWith("GRANT USAGE ON *.* TO ") || grant.startsWith(projectDml))
  );
}

function versionIsSupported(version: string, requiredVersion: string) {
  const actual = version.match(/^(\d+\.\d+(?:\.\d+)?)/)?.[1];
  return actual === requiredVersion;
}

async function assertServerVersion(connection: Connection, config: MysqlAdminConfig) {
  const [rows] = await connection.query<Array<RowDataPacket & { version: string }>>("SELECT VERSION() AS version");
  const version = rows[0]?.version;
  if (!version || !versionIsSupported(version, config.requiredVersion)) {
    throw new Error(`MySQL 版本不满足要求：实际 ${version ?? "未知"}，需要 ${config.requiredVersion} 系列`);
  }
  return version;
}

async function ensureMigrationMetadata(connection: Connection, app: MysqlAppConfig) {
  const database = quoteIdentifier(app.database);
  await connection.query(
    `CREATE TABLE IF NOT EXISTS ${database}.schema_migrations (
      id VARCHAR(128) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  const [rows] = await connection.query<Array<RowDataPacket & { checksum: string }>>(
    `SELECT checksum FROM ${database}.schema_migrations WHERE id = ?`,
    [BOOTSTRAP_MIGRATION.id]
  );
  const existing = rows[0];
  if (existing && existing.checksum !== BOOTSTRAP_MIGRATION.checksum) {
    throw new Error("MySQL 初始化元数据校验失败：已有 bootstrap 迁移校验值不一致");
  }
  if (!existing) {
    await connection.query(
      `INSERT INTO ${database}.schema_migrations (id, checksum) VALUES (?, ?)`,
      [BOOTSTRAP_MIGRATION.id, BOOTSTRAP_MIGRATION.checksum]
    );
  }
  return !existing;
}

async function ensureApplicationAccount(connection: Connection, app: MysqlAppConfig) {
  const database = quoteIdentifier(app.database);
  const account = accountName(app);
  await connection.query(`CREATE USER IF NOT EXISTS ${account} IDENTIFIED BY ${quoteString(app.password)}`);
  const [rows] = await connection.query<Array<RowDataPacket & Record<string, string>>>(`SHOW GRANTS FOR ${account}`);
  const grants = rows.flatMap((row) => Object.values(row));
  if (!grants.every((grant) => isAllowedApplicationGrant(grant, app.database))) {
    throw new Error("应用账号已有项目库以外的授权；请为 MYSQL_USER 配置未被其他服务使用的专用账号");
  }
  // 账号已证明为本项目专用，密码轮换和重复授权不会影响其他数据库或服务。
  await connection.query(`ALTER USER ${account} IDENTIFIED BY ${quoteString(app.password)}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${database}.* TO ${account}`);
}

async function assertApplicationConnection(app: MysqlAppConfig) {
  const connection = await mysql.createConnection({
    host: app.host,
    port: app.port,
    database: app.database,
    user: app.user,
    password: app.password,
  });
  try {
    await connection.query("SELECT 1");
  } finally {
    await connection.end();
  }
}

export async function initializeMysql(env: NodeJS.ProcessEnv = process.env): Promise<MysqlInitializationResult> {
  const app = getMysqlAppConfig(env);
  const admin = getMysqlAdminConfig(env);
  const connection = await mysql.createConnection({
    host: admin.host,
    port: admin.port,
    user: admin.user,
    password: admin.password,
  });

  try {
    const serverVersion = await assertServerVersion(connection, admin);
    const database = quoteIdentifier(app.database);
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    const migrationApplied = await ensureMigrationMetadata(connection, app);
    await ensureApplicationAccount(connection, app);
    await assertApplicationConnection(app);
    return { serverVersion, migrationApplied };
  } finally {
    await connection.end();
  }
}
