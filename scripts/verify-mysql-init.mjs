import nextEnv from "@next/env";
import mysql from "mysql2/promise";

if (process.env.AI_MODE !== "replay") {
  console.error("❌ 验证要求 AI_MODE=replay，未运行");
  process.exit(1);
}

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const { getMysqlAdminConfig, getMysqlAppConfig, MysqlConfigurationError } = await import("../src/lib/mysql-config.ts");
const { initializeMysql, isAllowedApplicationGrant } = await import("../src/lib/mysql-bootstrap.ts");

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
  let adminConnection;
  try {
    const first = await initializeMysql();
    const second = await initializeMysql();
    const app = getMysqlAppConfig();
    const admin = getMysqlAdminConfig();
    adminConnection = await mysql.createConnection({
      host: admin.host,
      port: admin.port,
      user: admin.user,
      password: admin.password,
      database: app.database,
    });
    const [migrations] = await adminConnection.query(
      "SELECT id, checksum FROM schema_migrations WHERE id = ?",
      ["0001_mysql_bootstrap"]
    );
    const [grants] = await adminConnection.query(
      `SHOW GRANTS FOR ${mysql.escape(app.user)}@${mysql.escape(app.appHost)}`
    );
    const grantsText = grants.flatMap((grant) => Object.values(grant)).join("\n");

    check("首次初始化通过精确版本校验", first.serverVersion.startsWith("9.7.2"));
    check("重复初始化不会重复应用 bootstrap 迁移", first.migrationApplied && !second.migrationApplied);
    check("迁移元数据仅有一条 bootstrap 记录", migrations.length === 1);
    check(
      "应用账号仅获项目库 DML 权限",
      grants.some((grant) => grant.startsWith(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${app.database}\`.* TO `)) &&
        grantsText.includes(`\`${app.database}\`.*`) &&
        grants.every((grant) => isAllowedApplicationGrant(grant, app.database))
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
