import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";

import {
  getMysqlAdminConfig,
  getMysqlAppConfig,
  getMysqlMigrationConfig,
  getMysqlConnectionOptions,
  getMysqlRequiredVersion,
  type MysqlAdminConfig,
  type MysqlAppConfig,
} from "@/lib/mysql-config";

export const MYSQL_MIGRATIONS = [
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
  {
    id: "0004_conversation_recovery_concurrency",
    checksum: "6e1b6826b9cd52c4bc6025c657fe126960feca1b52d8dcf390ed6c2a69a01478",
    statements: [
      "ALTER TABLE tabs ADD COLUMN active_operation_id VARCHAR(160) NULL",
      "ALTER TABLE tab_operations ADD COLUMN locked_version INT UNSIGNED NULL",
      "ALTER TABLE tab_operations MODIFY COLUMN status ENUM('pending', 'processing', 'completed', 'conflict', 'failed') NOT NULL",
      `CREATE TABLE IF NOT EXISTS messages (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tab_id CHAR(36) NOT NULL,
        role ENUM('user', 'assistant') NOT NULL,
        content MEDIUMTEXT NOT NULL,
        timestamp DATETIME(3) NOT NULL,
        status ENUM('generating', 'completed', 'interrupted', 'failed') NULL,
        error_message TEXT NULL,
        request_id VARCHAR(160) NULL,
        replacement_target_id CHAR(36) NULL,
        replacement_commit_message_id CHAR(36) NULL,
        superseded_by_message_id CHAR(36) NULL,
        replacement_committed BOOLEAN NOT NULL DEFAULT FALSE,
        replacement_kind ENUM('regenerate', 'edit', 'retry') NULL,
        replacement_user_message_id CHAR(36) NULL,
        file_provenance_version INT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT messages_tab_fk FOREIGN KEY (tab_id) REFERENCES tabs(id),
        CONSTRAINT messages_replacement_target_fk FOREIGN KEY (replacement_target_id) REFERENCES messages(id),
        CONSTRAINT messages_replacement_commit_fk FOREIGN KEY (replacement_commit_message_id) REFERENCES messages(id),
        CONSTRAINT messages_superseded_by_fk FOREIGN KEY (superseded_by_message_id) REFERENCES messages(id),
        CONSTRAINT messages_replacement_user_fk FOREIGN KEY (replacement_user_message_id) REFERENCES messages(id),
        UNIQUE KEY messages_tab_request_unique (tab_id, request_id),
        KEY messages_tab_timestamp (tab_id, timestamp, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    ],
  },
  {
    id: "0005_project_artifacts",
    checksum: "891f3c6c721d8a1091c3d6de5d4f3705fd5fbdc44c4c968399f2a9b43fb0e2ce",
    statements: [
      `CREATE TABLE IF NOT EXISTS project_files (
        id CHAR(36) NOT NULL PRIMARY KEY,
        project_id CHAR(36) NOT NULL,
        filename VARCHAR(700) NOT NULL,
        content MEDIUMTEXT NOT NULL,
        version INT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT project_files_project_fk FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE KEY project_files_project_filename_unique (project_id, filename),
        KEY project_files_project_updated (project_id, updated_at, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS agent_file_contexts (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tab_id CHAR(36) NOT NULL,
        file_id CHAR(36) NOT NULL,
        loaded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT agent_file_contexts_tab_fk FOREIGN KEY (tab_id) REFERENCES tabs(id) ON DELETE CASCADE,
        CONSTRAINT agent_file_contexts_file_fk FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE,
        UNIQUE KEY agent_file_contexts_tab_file_unique (tab_id, file_id),
        KEY agent_file_contexts_file (file_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS prototype_snapshots (
        id CHAR(36) NOT NULL PRIMARY KEY,
        project_id CHAR(36) NOT NULL,
        tab_id CHAR(36) NULL,
        content MEDIUMTEXT NOT NULL,
        version INT UNSIGNED NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT prototype_snapshots_project_fk FOREIGN KEY (project_id) REFERENCES projects(id),
        CONSTRAINT prototype_snapshots_tab_fk FOREIGN KEY (tab_id) REFERENCES tabs(id) ON DELETE SET NULL,
        UNIQUE KEY prototype_snapshots_project_version_unique (project_id, version),
        KEY prototype_snapshots_project_created (project_id, created_at, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS message_file_writes (
        id CHAR(36) NOT NULL PRIMARY KEY,
        message_id CHAR(36) NOT NULL,
        tab_id CHAR(36) NOT NULL,
        project_id CHAR(36) NOT NULL,
        project_file_id CHAR(36) NOT NULL,
        filename VARCHAR(700) NOT NULL,
        operation ENUM('create', 'update') NOT NULL,
        file_version INT UNSIGNED NOT NULL,
        message_status ENUM('completed') NOT NULL,
        write_status ENUM('written') NOT NULL,
        written_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT message_file_writes_message_fk FOREIGN KEY (message_id) REFERENCES messages(id),
        CONSTRAINT message_file_writes_tab_fk FOREIGN KEY (tab_id) REFERENCES tabs(id),
        CONSTRAINT message_file_writes_project_fk FOREIGN KEY (project_id) REFERENCES projects(id),
        CONSTRAINT message_file_writes_file_fk FOREIGN KEY (project_file_id) REFERENCES project_files(id) ON DELETE CASCADE,
        UNIQUE KEY message_file_writes_message_filename_version_unique (message_id, filename, file_version),
        KEY message_file_writes_tab_message_written (tab_id, message_id, written_at),
        KEY message_file_writes_project_file (project_id, project_file_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    ],
  },
  {
    id: "0006_explicit_freeze",
    checksum: "8f9d5ad148a02ed1341f70d54d96900e3dc22c5e60579ec0d5b51fd9fe663efe",
    statements: [
      "ALTER TABLE tabs ADD COLUMN freeze_message_id CHAR(36) NULL",
      "ALTER TABLE tabs ADD COLUMN freeze_filename VARCHAR(1024) NULL",
      "ALTER TABLE tabs ADD COLUMN freeze_document_digest CHAR(64) NULL",
      "ALTER TABLE tabs ADD COLUMN freeze_error TEXT NULL",
      "ALTER TABLE project_files ADD COLUMN freeze_binding_tab_id CHAR(36) NULL",
      "ALTER TABLE project_files ADD COLUMN freeze_binding_document_digest CHAR(64) NULL",
      "ALTER TABLE project_files ADD COLUMN freeze_binding_locked_at DATETIME(3) NULL",
      "CREATE INDEX project_files_freeze_binding_tab ON project_files (freeze_binding_tab_id)",
    ],
  },
  {
    id: "0007_tab_message_mutations",
    checksum: "e288c84d9a5d4e5299ed47a2100345da3c3d6d88365e1574154064c0eb775c15",
    statements: [
      `CREATE TABLE IF NOT EXISTS tab_deletion_operations (
        tab_id CHAR(36) NOT NULL,
        request_id VARCHAR(160) NOT NULL,
        user_id CHAR(36) NOT NULL,
        response_json JSON NOT NULL,
        tab_version INT UNSIGNED NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (tab_id, request_id),
        KEY tab_deletion_operations_user_created (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    ],
  },
  {
    id: "0008_product_iteration_lifecycle",
    checksum: "8b52bc37f6ce8b0a4e3a6b2a7c6f4d2a1c9e8b7d6f5a4c3b2a19081726354455",
    statements: [
      "ALTER TABLE projects ADD COLUMN next_iteration_number INT UNSIGNED NOT NULL DEFAULT 1",
      "ALTER TABLE work_records ADD COLUMN iteration_number INT UNSIGNED NULL",
      "ALTER TABLE work_records ADD COLUMN goal TEXT NULL",
      "ALTER TABLE work_records ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)",
      "ALTER TABLE work_records ADD UNIQUE KEY work_records_project_iteration_unique (project_id, iteration_number)",
    ],
  },
  {
    id: "0009_v141_product_iterations_reset",
    checksum: "e7fefc4f5a3d8d5e7d2b95cfd6d77f745db9c6cfb2b484cdce6a0f9a6c7e2d11",
    statements: [
      // v1.41 从全新迭代模型开始，旧版本数据和工作区记录全部退役。
      "SET FOREIGN_KEY_CHECKS = 0",
      "TRUNCATE TABLE message_file_writes",
      "TRUNCATE TABLE agent_file_contexts",
      "TRUNCATE TABLE messages",
      "TRUNCATE TABLE tab_operations",
      "TRUNCATE TABLE tab_deletion_operations",
      "TRUNCATE TABLE tabs",
      "TRUNCATE TABLE project_files",
      "TRUNCATE TABLE prototype_snapshots",
      "TRUNCATE TABLE work_records",
      "TRUNCATE TABLE projects",
      "TRUNCATE TABLE users",
      "SET FOREIGN_KEY_CHECKS = 1",
      "UPDATE projects SET next_iteration_number = 1",
      `CREATE TABLE IF NOT EXISTS product_iterations (
        id CHAR(36) NOT NULL PRIMARY KEY,
        project_id CHAR(36) NOT NULL,
        iteration_number INT UNSIGNED NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        goal TEXT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT product_iterations_name_not_blank CHECK (CHAR_LENGTH(TRIM(display_name)) > 0),
        CONSTRAINT product_iterations_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE KEY product_iterations_project_number_unique (project_id, iteration_number),
        KEY product_iterations_project_updated (project_id, updated_at, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    ],
  },
  {
    id: "0010_v141_retire_legacy_iteration_columns",
    checksum: "a6c6f7baf6f6d32a16c9f6bcb8f1457f2d74bf9e8c2e0e5a4af3af4c5f3f7a12",
    statements: [
      "ALTER TABLE work_records DROP INDEX work_records_project_iteration_unique",
      "ALTER TABLE work_records DROP COLUMN iteration_number",
      "ALTER TABLE work_records DROP COLUMN goal",
      "ALTER TABLE work_records DROP COLUMN updated_at",
    ],
  },
  {
    id: "0011_v141_iteration_workbench",
    checksum: "b21beac559c48c309ce5ed7c0b6cfc03e5c8b0084f5c687c813b9e771a25d769",
    statements: [
      "ALTER TABLE product_iterations ADD COLUMN current_stage ENUM('requirements', 'prototype', 'prd', 'tasks') NOT NULL DEFAULT 'requirements'",
      `CREATE TABLE IF NOT EXISTS iteration_stage_states (
        iteration_id CHAR(36) NOT NULL,
        stage ENUM('requirements', 'prototype', 'prd', 'tasks') NOT NULL,
        status ENUM('not_started', 'in_progress', 'completed') NOT NULL DEFAULT 'not_started',
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (iteration_id, stage),
        CONSTRAINT iteration_stage_states_iteration_fk FOREIGN KEY (iteration_id) REFERENCES product_iterations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS iteration_sessions (
        id CHAR(36) NOT NULL PRIMARY KEY,
        iteration_id CHAR(36) NOT NULL,
        stage ENUM('requirements', 'prototype', 'prd', 'tasks') NOT NULL,
        title VARCHAR(255) NOT NULL DEFAULT '新会话',
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT iteration_sessions_iteration_fk FOREIGN KEY (iteration_id) REFERENCES product_iterations(id) ON DELETE CASCADE,
        KEY iteration_sessions_iteration_stage_updated (iteration_id, stage, updated_at, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS iteration_session_messages (
        id CHAR(36) NOT NULL PRIMARY KEY,
        session_id CHAR(36) NOT NULL,
        role ENUM('user', 'assistant') NOT NULL,
        content MEDIUMTEXT NOT NULL,
        status ENUM('generating', 'completed', 'failed') NOT NULL DEFAULT 'completed',
        error_message TEXT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT iteration_session_messages_session_fk FOREIGN KEY (session_id) REFERENCES iteration_sessions(id) ON DELETE CASCADE,
        KEY iteration_session_messages_session_created (session_id, created_at, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS iteration_session_context_files (
        session_id CHAR(36) NOT NULL,
        file_id CHAR(36) NOT NULL,
        loaded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (session_id, file_id),
        CONSTRAINT iteration_session_context_session_fk FOREIGN KEY (session_id) REFERENCES iteration_sessions(id) ON DELETE CASCADE,
        CONSTRAINT iteration_session_context_file_fk FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE,
        KEY iteration_session_context_file (file_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    ],
  },
  {
    id: "0012_account_nickname",
    checksum: "655ce2ca09145eca65b79cb9dcceb3197866712a3fbf3b58e6d47b9a98e0540d",
    statements: ["ALTER TABLE users ADD COLUMN nickname VARCHAR(40) NULL AFTER email"],
  },
  {
    id: "0013_v141_first_file_candidate",
    checksum: "c2ae3a6b4a31f1c4b91b6b827268c5d4cf12bf309d318c69f87e05d57d739a80",
    statements: [
      "ALTER TABLE project_files ADD COLUMN previous_content MEDIUMTEXT NULL AFTER content",
      `CREATE TABLE IF NOT EXISTS iteration_file_candidates (
        id CHAR(36) NOT NULL PRIMARY KEY,
        message_id CHAR(36) NOT NULL,
        session_id CHAR(36) NOT NULL,
        suggested_filename VARCHAR(700) NOT NULL,
        content MEDIUMTEXT NOT NULL,
        status ENUM('pending', 'discarded', 'written') NOT NULL DEFAULT 'pending',
        final_filename VARCHAR(700) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        decided_at DATETIME(3) NULL,
        CONSTRAINT iteration_file_candidates_message_fk FOREIGN KEY (message_id) REFERENCES iteration_session_messages(id) ON DELETE CASCADE,
        CONSTRAINT iteration_file_candidates_session_fk FOREIGN KEY (session_id) REFERENCES iteration_sessions(id) ON DELETE CASCADE,
        UNIQUE KEY iteration_file_candidates_message_unique (message_id),
        KEY iteration_file_candidates_session_status (session_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS project_file_changes (
        id CHAR(36) NOT NULL PRIMARY KEY,
        project_id CHAR(36) NOT NULL,
        file_id CHAR(36) NOT NULL,
        operation ENUM('create', 'overwrite') NOT NULL,
        filename VARCHAR(700) NOT NULL,
        content_revision INT UNSIGNED NOT NULL,
        actor ENUM('agent', 'user') NOT NULL,
        iteration_id CHAR(36) NULL,
        iteration_number INT UNSIGNED NOT NULL,
        iteration_name VARCHAR(255) NOT NULL,
        stage ENUM('analysis', 'prototype', 'prd', 'tickets') NULL,
        session_id CHAR(36) NULL,
        session_name VARCHAR(255) NULL,
        message_id CHAR(36) NULL,
        occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT project_file_changes_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        KEY project_file_changes_file_time (file_id, occurred_at, id),
        KEY project_file_changes_project_iteration (project_id, iteration_id, occurred_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    ],
  },
  {
    id: "0014_v141_exact_file_paths",
    checksum: "b4d4f282e80bc5c283ce73ac66f6464766f34cfd3d91ad3be207ad9743cad442",
    statements: ["ALTER TABLE project_files MODIFY filename VARCHAR(700) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL"],
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

async function runMigrationStatement(connection: Connection, statement: string) {
  try {
    await connection.query(statement);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    // MySQL 没有 ADD COLUMN/CREATE INDEX IF NOT EXISTS；允许未记录迁移的重跑跳过已完成的结构变更。
    if (code === "ER_DUP_FIELDNAME" || code === "ER_DUP_KEYNAME") return;
    throw error;
  }
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
  if (!actual) return false;
  const actualParts = actual.split(".");
  return requiredVersion.split(",").some((requirement) => {
    const requiredParts = requirement.split(".");
    return requiredParts.every((part, index) => actualParts[index] === part);
  });
}

async function assertServerVersion(connection: Connection, config: Pick<MysqlAdminConfig, "requiredVersion">) {
  const [rows] = await connection.query<Array<RowDataPacket & { version: string }>>("SELECT VERSION() AS version");
  const version = rows[0]?.version;
  if (!version || !versionIsSupported(version, config.requiredVersion)) {
    throw new Error(`MySQL 版本不满足要求：实际 ${version ?? "未知"}，需要 ${config.requiredVersion} 系列`);
  }
  return version;
}

async function ensureMigrations(connection: Connection, app: MysqlAppConfig) {
  const database = quoteIdentifier(app.database);
  // 迁移语句使用未限定表名，必须先切换到项目数据库上下文。
  await connection.query(`USE ${database}`);
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
      await runMigrationStatement(connection, statement);
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
  const connection = await mysql.createConnection(getMysqlConnectionOptions(app));
  try {
    await connection.query("SELECT 1");
  } finally {
    await connection.end();
  }
}

export async function initializeMysql(env: NodeJS.ProcessEnv = process.env): Promise<MysqlInitializationResult> {
  const app = getMysqlAppConfig(env);
  const admin = getMysqlAdminConfig(env);
  const connection = await mysql.createConnection(getMysqlConnectionOptions(admin));

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

/**
 * 托管数据库常常不允许 CREATE USER/CREATE DATABASE。该入口只使用应用账号
 * 执行已存在数据库中的迁移，管理员初始化仍由 initializeMysql 负责。
 */
export async function migrateMysql(env: NodeJS.ProcessEnv = process.env): Promise<MysqlInitializationResult> {
  const app = getMysqlMigrationConfig(env);
  const connection = await mysql.createConnection(getMysqlConnectionOptions(app));

  try {
    const serverVersion = await assertServerVersion(connection, {
      requiredVersion: getMysqlRequiredVersion(env),
    });
    const migrationApplied = await ensureMigrations(connection, app);
    return { serverVersion, migrationApplied };
  } finally {
    await connection.end();
  }
}
