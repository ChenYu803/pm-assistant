import nextEnv from "@next/env";
import mysql from "mysql2/promise";

nextEnv.loadEnvConfig(process.cwd());

if (process.env.AI_MODE !== "replay") {
  console.error("❌ 验证要求 AI_MODE=replay，未运行");
  process.exit(1);
}

const { getMysqlAdminConfig, getMysqlAppConfig, MysqlConfigurationError, mysqlVersionMatchesRequired } = await import("../src/lib/mysql-config.ts");
const { initializeMysql, isAllowedApplicationGrant, MYSQL_MIGRATIONS } = await import("../src/lib/mysql-bootstrap.ts");

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`✅ ${name}`);
  } else {
    fail += 1;
    console.error(`❌ ${name}${detail ? `：${detail}` : ""}`);
  }
}

async function main() {
  check("版本边界接受本机已验收的 MySQL 9.7.2", mysqlVersionMatchesRequired("9.7.2", "9.7"));
  check("版本边界接受目标机 MySQL 9.7.4 补丁版本", mysqlVersionMatchesRequired("9.7.4", "9.7"));
  check("版本边界拒绝其他系列及 MariaDB", !mysqlVersionMatchesRequired("8.4.7", "9.7") && !mysqlVersionMatchesRequired("10.11.6-MariaDB", "9.7"));
  check("不允许把运行门禁改成未支持的 8.4", !mysqlVersionMatchesRequired("8.4.7", "8.4"));
  let adminConnection;
  try {
    const app = getMysqlAppConfig();
    const admin = getMysqlAdminConfig();
    const beforeConnection = await mysql.createConnection({
      host: admin.host,
      port: admin.port,
      user: admin.user,
      password: admin.password,
    });
    let beforeRows = [];
    try {
      [beforeRows] = await beforeConnection.query(`SELECT id FROM \`${app.database}\`.schema_migrations`);
    } catch (error) {
      if (!["ER_BAD_DB_ERROR", "ER_NO_SUCH_TABLE"].includes(error?.code)) throw error;
    }
    await beforeConnection.end();

    const first = await initializeMysql();
    const second = await initializeMysql();
    adminConnection = await mysql.createConnection({
      host: admin.host,
      port: admin.port,
      user: admin.user,
      password: admin.password,
      database: app.database,
    });
    const [migrations] = await adminConnection.query("SELECT id, checksum FROM schema_migrations ORDER BY id");
    const [grants] = await adminConnection.query(
      `SHOW GRANTS FOR ${mysql.escape(app.user)}@${mysql.escape(app.appHost)}`
    );
    const grantValues = grants.flatMap((grant) => Object.values(grant)).map(String);
    const grantsText = grantValues.join("\n");

    const migrationMap = new Map(migrations.map((migration) => [migration.id, migration.checksum]));
    const complete = MYSQL_MIGRATIONS.every((migration) => migrationMap.get(migration.id) === migration.checksum);
    check("初始化通过 MySQL 9.7 LTS 系列校验", /^9\.7\.\d+/.test(first.serverVersion));
    check(
      "重复初始化保持幂等",
      beforeRows.length < MYSQL_MIGRATIONS.length
        ? first.migrationApplied && !second.migrationApplied
        : !first.migrationApplied && !second.migrationApplied,
    );
    check("schema_migrations 包含全部已发布迁移且校验值一致", complete && migrations.length === MYSQL_MIGRATIONS.length);
    check(
      "应用账号仅获项目库 DML 权限",
      grantValues.some((grant) => grant.startsWith(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${app.database}\`.* TO `)) &&
        grantsText.includes(`\`${app.database}\`.*`) &&
        grantValues.every((grant) => isAllowedApplicationGrant(grant, app.database))
    );
  } catch (error) {
    const detail = error instanceof MysqlConfigurationError ? error.message : error.message;
    check("MySQL 初始化环境可用", false, detail);
  } finally {
    await adminConnection?.end();
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
