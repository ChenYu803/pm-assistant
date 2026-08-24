export interface MysqlAppConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  appHost: string;
}

export interface MysqlAdminConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  requiredVersion: string;
}

export class MysqlConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MysqlConfigurationError";
  }
}

type Env = NodeJS.ProcessEnv;

const IDENTIFIER_RE = /^[A-Za-z0-9_]{1,64}$/;
const ACCOUNT_HOST_RE = /^[A-Za-z0-9.%:_-]{1,255}$/;
const RESERVED_DATABASES = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
]);
const VERIFIED_MYSQL_VERSION = "9.7.2";

function required(env: Env, name: string) {
  const value = env[name]?.trim();
  if (!value) {
    throw new MysqlConfigurationError(`缺少环境变量 ${name}`);
  }
  return value;
}

function port(env: Env, name: string) {
  const value = required(env, name);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new MysqlConfigurationError(`${name} 必须是 1 到 65535 的端口号`);
  }
  return parsed;
}

function identifier(value: string, name: string) {
  if (!IDENTIFIER_RE.test(value)) {
    throw new MysqlConfigurationError(`${name} 只能使用字母、数字和下划线，长度不超过 64`);
  }
  return value;
}

export function getMysqlAppConfig(env: Env = process.env): MysqlAppConfig {
  const database = identifier(required(env, "MYSQL_DATABASE"), "MYSQL_DATABASE");
  if (RESERVED_DATABASES.has(database.toLowerCase())) {
    throw new MysqlConfigurationError("MYSQL_DATABASE 不能使用 MySQL 系统数据库名称");
  }

  const appHost = env.MYSQL_APP_HOST?.trim() || "localhost";
  if (!ACCOUNT_HOST_RE.test(appHost)) {
    throw new MysqlConfigurationError("MYSQL_APP_HOST 含有不允许的字符");
  }

  const user = identifier(required(env, "MYSQL_USER"), "MYSQL_USER");
  if (user.toLowerCase() === "root") {
    throw new MysqlConfigurationError("MYSQL_USER 不能使用 root；网站必须使用专用应用账号");
  }

  return {
    host: required(env, "MYSQL_HOST"),
    port: port(env, "MYSQL_PORT"),
    database,
    user,
    password: required(env, "MYSQL_PASSWORD"),
    appHost,
  };
}

export function getMysqlAdminConfig(env: Env = process.env): MysqlAdminConfig {
  const app = getMysqlAppConfig(env);
  const user = identifier(required(env, "MYSQL_ADMIN_USER"), "MYSQL_ADMIN_USER");
  if (user === app.user) {
    throw new MysqlConfigurationError("MYSQL_ADMIN_USER 不能与 MYSQL_USER 相同；初始化和网站必须使用不同身份");
  }
  const requiredVersion = env.MYSQL_REQUIRED_VERSION?.trim() || VERIFIED_MYSQL_VERSION;
  if (requiredVersion !== VERIFIED_MYSQL_VERSION) {
    throw new MysqlConfigurationError(`MYSQL_REQUIRED_VERSION 当前只能是已验证的 ${VERIFIED_MYSQL_VERSION}`);
  }

  return {
    host: env.MYSQL_ADMIN_HOST?.trim() || app.host,
    port: env.MYSQL_ADMIN_PORT?.trim() ? port(env, "MYSQL_ADMIN_PORT") : app.port,
    user,
    password: required(env, "MYSQL_ADMIN_PASSWORD"),
    requiredVersion,
  };
}
