import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";

import {
  getMysqlAdminConfig,
  getMysqlAppConfig,
  type MysqlAdminConfig,
  type MysqlAppConfig,
} from "@/lib/mysql-config";

const MYSQL_MIGRATIONS = [
  {
    id: "0001_mysql_bootstrap",
    checksum: "a5ab0ee5918634b01d8d00681f5f4f91f8e00cd074194d36ccbf2b6b9c4d56e5",
    statements: [] as string[],
  },
  {
    id: "0002_account_project_workspace",
    checksum: "d24a4d2aab9b4f142e148c8dd2d9e1df1faef94747e5bbf0a279dca4aa80c853",
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id CHAR(36) NOT NULL PRIMARY KEY,
        email VARCHAR(320) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY users_email_unique (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS projects (
        id CHAR(36) NOT NULL PRIMARY KEY,
        user_id CHAR(36) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT projects_name_not_blank CHECK (CHAR_LENGTH(TRIM(name)) > 0),
        CONSTRAINT projects_user_fk FOREIGN KEY (user_id) REFERENCES users(id),
        KEY projects_user_created (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS work_records (
        id CHAR(36) NOT NULL PRIMARY KEY,
        project_id CHAR(36) NOT NULL,
        name VARCHAR(255) NOT NULL DEFAULT '未命名',
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT work_records_name_not_blank CHECK (CHAR_LENGTH(TRIM(name)) > 0),
        CONSTRAINT work_records_project_fk FOREIGN KEY (project_id) REFERENCES projects(id),
        KEY work_records_project_created (project_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS tabs (
        id CHAR(36) NOT NULL PRIMARY KEY,
        work_record_id CHAR(36) NOT NULL,
        agent_type ENUM('requirement_analyst', 'mvp_prd', 'prototype', 'ticket_splitter') NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        position INT UNSIGNED NOT NULL,
        version INT UNSIGNED NOT NULL DEFAULT 0,
        scope_frozen BOOLEAN NOT NULL DEFAULT FALSE,
        freeze_status ENUM('idle', 'proposed', 'generating', 'awaiting_write', 'frozen', 'failed') NOT NULL DEFAULT 'idle',
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT tabs_display_name_not_blank CHECK (CHAR_LENGTH(TRIM(display_name)) > 0),
        CONSTRAINT tabs_work_record_fk FOREIGN KEY (work_record_id) REFERENCES work_records(id),
        UNIQUE KEY tabs_work_record_position_unique (work_record_id, position),
        KEY tabs_work_record_agent_type (work_record_id, agent_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    ],
  },
  {
    id: "0003_tab_operations",
    checksum: "53cff3da301ffa74fb4e5ae8be98346cb0c8f66dd4fa976b511481c2aad2d9d2",
    statements: [
      `CREATE TABLE IF NOT EXISTS tab_operations (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tab_id CHAR(36) NOT NULL,
        request_id VARCHAR(160) NOT NULL,
        operation VARCHAR(64) NOT NULL,
        expected_version INT UNSIGNED NOT NULL,
        status ENUM('completed', 'conflict') NOT NULL,
        response_json JSON NULL,
        tab_version INT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT tab_operations_tab_fk FOREIGN KEY (tab_id) REFERENCES tabs(id),
        UNIQUE KEY tab_operations_tab_request_unique (tab_id, request_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    ],
  },
] as const;

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

async function ensureMigrations(connection: Connection, app: MysqlAppConfig) {
  const database = quoteIdentifier(app.database);
  await connection.query(
    `CREATE TABLE IF NOT EXISTS ${database}.schema_migrations (
      id VARCHAR(128) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  let applied = false;
  for (const migration of MYSQL_MIGRATIONS) {
    const [rows] = await connection.query<Array<RowDataPacket & { checksum: string }>>(
      `SELECT checksum FROM ${database}.schema_migrations WHERE id = ?`,
      [migration.id]
    );
    const existing = rows[0];
    if (existing && existing.checksum !== migration.checksum) {
      throw new Error(`MySQL 初始化元数据校验失败：迁移 ${migration.id} 的校验值不一致`);
    }
    if (existing) continue;

    for (const statement of migration.statements) {
      await connection.query(`${statement}`);
    }
    await connection.query(
      `INSERT INTO ${database}.schema_migrations (id, checksum) VALUES (?, ?)`,
      [migration.id, migration.checksum]
    );
    applied = true;
  }
  return applied;
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
    const migrationApplied = await ensureMigrations(connection, app);
    await ensureApplicationAccount(connection, app);
    await assertApplicationConnection(app);
    return { serverVersion, migrationApplied };
  } finally {
    await connection.end();
  }
}
