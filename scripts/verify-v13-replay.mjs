// v1.3 #13 综合回放入口：先做环境/schema 门禁，再按类别串行运行 MySQL 专项。
// 子专项的业务断言保留在各自日志；本入口只汇总专项名称、退出码和定位摘要。
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import nextEnv from "@next/env";
import mysql from "mysql2/promise";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const REQUIRED_APP_ENV = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "AUTH_SECRET"];
const REQUIRED_ADMIN_ENV = ["MYSQL_ADMIN_USER", "MYSQL_ADMIN_PASSWORD"];
const DATA_TABLES = [
  "users",
  "projects",
  "work_records",
  "tabs",
  "tab_operations",
  "tab_deletion_operations",
  "messages",
  "project_files",
  "agent_file_contexts",
  "prototype_snapshots",
  "message_file_writes",
];

const suites = [
  ["初始化", "verify:mysql-init"],
  ["账号/工作区", "verify:account-project-workspace"],
  ["对话恢复与并发", "verify:mysql-conversation"],
  ["tab/消息变更", "verify:mysql-tab-message-mutations"],
  ["项目成果与 tickets", "verify:mysql-project-artifacts"],
  ["显式冻结", "verify:mysql-explicit-freeze"],
  ["级联删除", "verify:mysql-cascade-delete"],
  ["安全", "verify:mysql-markdown-safety"],
  ["上下文用量", "verify:mysql-context-usage"],
  ["列表渲染", "verify:mysql-list-rendering"],
  ["UI 修复", "verify:mysql-ui-fixes"],
  ["可访问性", "verify:a11y"],
  ["Agent 类型", "verify:agent-types"],
  ["PRD 六章", "verify:prd-six-section"],
  ["需求分析专项", "verify:requirement-analyst"],
  ["原型专项", "verify:prototype-agent"],
  ["任务拆分专项", "verify:ticket-splitter"],
  ["四环浏览器冒烟", "verify:v1-flow"],
  ["文件协议与快照", "verify:file-protocol-snapshots"],
  ["协议静态检查", "verify:protocols"],
];
let completedSuites = 0;

function fail(message, category = "环境") {
  console.error(`❌ [${category}] ${message}`);
  console.log(`结果: 0 通过, 0 失败, ${suites.length - completedSuites} 项未运行（${category}门禁）`);
  process.exit(1);
}

function redact(value) {
  return value.replace(/(password|secret|key|token)=([^&\s]+)/gi, "$1=<redacted>");
}

async function assertBrowser() {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
  } catch (error) {
    fail(`Chromium 不可用：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function assertService() {
  try {
    const response = await fetch(`${BASE}/api/verify/replay-mode`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.aiMode !== "replay") {
      fail(`验证服务未处于 replay：HTTP ${response.status}，服务报告 ${body.aiMode ?? "未知"}`);
    }
  } catch (error) {
    fail(`验证服务不可用（${BASE}）：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function assertMysqlAndSchema() {
  const { getMysqlAdminConfig, getMysqlAppConfig } = await import("../src/lib/mysql-config.ts");
  const { MYSQL_MIGRATIONS } = await import("../src/lib/mysql-bootstrap.ts");
  const app = getMysqlAppConfig();
  const admin = getMysqlAdminConfig();
  let adminConnection;
  let appConnection;
  try {
    adminConnection = await mysql.createConnection({ host: admin.host, port: admin.port, user: admin.user, password: admin.password });
    const [versionRows] = await adminConnection.query("SELECT VERSION() AS version");
    const version = versionRows[0]?.version ?? "未知";
    if (!String(version).startsWith("9.7.2")) fail(`MySQL 版本不兼容：实际 ${version}，需要 9.7.2 LTS`, "MySQL");

    appConnection = await mysql.createConnection({ host: app.host, port: app.port, user: app.user, password: app.password, database: app.database });
    const [migrationRows] = await appConnection.query("SELECT id, checksum FROM schema_migrations ORDER BY id");
    const migrationMap = new Map(migrationRows.map((row) => [row.id, row.checksum]));
    const schemaReady = MYSQL_MIGRATIONS.every((migration) => migrationMap.get(migration.id) === migration.checksum);
    if (!schemaReady || migrationRows.length !== MYSQL_MIGRATIONS.length) {
      fail(`schema/migrations 未完成：实际 ${migrationRows.length} 条，需要 ${MYSQL_MIGRATIONS.length} 条且校验值一致`, "schema");
    }

    const counts = [];
    for (const table of DATA_TABLES) {
      const [rows] = await appConnection.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
      counts.push(`${table}=${rows[0].count}`);
      if (Number(rows[0].count) !== 0) {
        fail(`要求从空 MySQL 开始，但数据库已有业务数据（${counts.join(", ")}）`, "环境");
      }
    }
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") fail("schema 不完整：缺少应用表，请先执行 npm run db:init", "schema");
    fail(`MySQL/schema 检查失败：${redact(error instanceof Error ? error.message : String(error))}`);
  } finally {
    await appConnection?.end();
    await adminConnection?.end();
  }
}

function summarize(name, code, output, logPath) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result = [...lines].reverse().find((line) => line.startsWith("结果:"));
  if (code === 0) return `${name} | 退出码 0 | ${result ?? "专项完成"}`;
  const schema = [...lines].reverse().find((line) => /^❌\s*\[schema\]/.test(line));
  const environment = [...lines].reverse().find((line) => /^❌\s*\[环境\]/.test(line) || /验证要求 AI_MODE|验证需要 .*?(MYSQL|HOOK|浏览器)/.test(line));
  const fixture = /夹具|fixture|CASCADE_DELETE_TEST_HOOKS|AUTO_NAME_TEST_HOOKS/i.test(output);
  const category = schema ? "schema" : environment ? "环境" : fixture ? "测试夹具" : "业务回归";
  const detail = schema ?? environment;
  return `${name} | 退出码 ${code ?? "信号终止"} | ${category}${detail ? `：${detail}` : "；专项断言详见日志"} | 日志 ${logPath}`;
}

async function runSuite([name, command], logDir) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const logPath = join(logDir, `${command.replaceAll(":", "-")}.log`);
  const childEnv = {
    ...process.env,
    AI_MODE: "replay",
    CASCADE_DELETE_TEST_HOOKS: "1",
    AUTO_NAME_TEST_HOOKS: "1",
    VERIFY_BASE_URL: BASE,
  };
  return await new Promise((resolve) => {
    const child = spawn(npm, ["run", command], { cwd: process.cwd(), env: childEnv, shell: false });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => { output += `\n${error.message}`; });
    child.on("close", async (code, signal) => {
      await writeFile(logPath, output, "utf8");
      resolve({ code: code ?? 1, summary: summarize(name, code, output, logPath), signal });
    });
  });
}

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  if (process.env.AI_MODE !== "replay") fail("AI_MODE 必须为 replay；入口不会自动切换 live/replay");
  const missing = [...REQUIRED_APP_ENV, ...REQUIRED_ADMIN_ENV].filter((name) => !process.env[name]?.trim());
  if (missing.length) fail(`缺少必要环境变量：${missing.join("、")}`);
  // 所有专项启动前先做只读版本、schema、迁移和空库门禁。
  await assertMysqlAndSchema();
  await assertBrowser();
  await assertService();

  const logDir = await mkdtemp(join(tmpdir(), "pm-assistant-v13-replay-"));
  const results = [];
  // 初始化专项负责证明已准备好的 schema 可重复初始化；其余专项共享同一空库门禁结果。
  const init = await runSuite(suites[0], logDir);
  results.push(init);
  if (init.code !== 0) {
    console.error(init.summary);
    console.log(`结果: 0 通过, 1 失败, ${suites.length - 1} 项未运行（初始化失败）`);
    process.exit(1);
  }
  completedSuites = 1;

  for (const suite of suites.slice(1)) {
    const result = await runSuite(suite, logDir);
    results.push(result);
    console.log(result.summary);
  }
  const failed = results.filter((result) => result.code !== 0);
  console.log(`\n综合结果：${results.length - failed.length} 个通过，${failed.length} 个失败，日志目录 ${logDir}`);
  process.exit(failed.length > 0 ? 1 : 0);
}

void main().catch((error) => fail(`入口异常：${redact(error instanceof Error ? error.message : String(error))}`));
