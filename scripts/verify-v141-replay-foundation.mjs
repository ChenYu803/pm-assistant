// v1.41 #19：独立空库 + 正式应用 + 连续浏览器回放，不清理日常业务库。
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm, cp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";
import { initializeMysql } from "../src/lib/mysql-bootstrap.ts";
import { getMysqlAdminConfig, getMysqlConnectionOptions } from "../src/lib/mysql-config.ts";

nextEnv.loadEnvConfig(process.cwd());
let pass = 0;
let fail = 0;
const outputDir = await mkdtemp(join(tmpdir(), "v141-replay-foundation-"));
const suffix = randomBytes(8).toString("hex");
const database = `v141_replay_${suffix}`;
// 临时源码和依赖必须位于同一 Turbopack root；Windows 副本与依赖同盘。
const buildDir = resolve(".next", database);
const projectDir = join(buildDir, "app");
const user = `v141_test_${suffix}`;
const env = {
  ...process.env,
  NODE_ENV: "development",
  AI_MODE: "replay",
  MYSQL_DATABASE: database,
  MYSQL_USER: user,
  MYSQL_PASSWORD: randomBytes(24).toString("hex"),
  AUTH_SECRET: randomBytes(32).toString("hex"),
  NEXT_TELEMETRY_DISABLED: "1",
  V141_REPLAY_OUTPUT_DIR: outputDir,
  V141_REPLAY_DEPENDENCY_ROOT: process.cwd(),
};
let admin;
let appConnection;
let server;
let scenario;
let databaseCreated = false;
let accountCreated = false;
let databaseRemoved = false;
let accountRemoved = false;
let workspaceCreated = false;
const account = `${mysql.escape(user)}@${mysql.escape(env.MYSQL_APP_HOST || "localhost")}`;
const secrets = [env.MYSQL_PASSWORD, env.AUTH_SECRET, process.env.MYSQL_ADMIN_PASSWORD, process.env.MYSQL_PASSWORD].filter(Boolean);
function sanitize(value) {
  let text = String(value);
  for (const secret of secrets) text = text.replaceAll(secret, "<已隐藏>");
  return text;
}
function check(name, condition) {
  if (condition) { pass++; console.log(`✅ ${name}`); }
  else { fail++; const error = new Error(name); error.counted = true; throw error; }
}
const logs = { server: "", scenario: "" };
function start(script, label, childEnv, cwd = process.cwd()) {
  const child = spawn(process.execPath, ["--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href, resolve(script)], {
    cwd, env: childEnv, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { logs[label] += chunk.toString(); });
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  if (child.connected) child.send({ type: "shutdown" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try { await exited; } finally { clearTimeout(timer); }
}
async function ready(child) {
  return new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => finish(new Error("隔离服务启动超过 120 秒")), 120_000);
    function finish(error, value) {
      clearTimeout(timer);
      child.off("message", onMessage); child.off("error", onError); child.off("exit", onExit);
      if (error) reject(error); else resolveReady(value);
    }
    const onMessage = (message) => {
      if (message?.type === "ready") {
        if (message.database !== database || !Number.isInteger(message.port)) finish(new Error("隔离服务身份不匹配"));
        else finish(null, `http://127.0.0.1:${message.port}`);
      }
    };
    const onError = (error) => finish(error);
    const onExit = (code) => finish(new Error(`隔离服务启动失败，退出码 ${code}`));
    child.on("message", onMessage); child.on("error", onError); child.on("exit", onExit);
  });
}

try {
  check("入口明确使用 replay", process.env.AI_MODE === "replay");
  const config = getMysqlAdminConfig(env);
  admin = await mysql.createConnection(getMysqlConnectionOptions(config));
  // 不使用 IF NOT EXISTS；只有本次确实创建的随机资源才有清理资格。
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  databaseCreated = true;
  await admin.query(`CREATE USER ${account} IDENTIFIED BY ${mysql.escape(env.MYSQL_PASSWORD)}`);
  accountCreated = true;
  const [before] = await admin.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
  check("从没有任何表的独立空库开始", before.length === 0);
  const initialized = await initializeMysql(env);
  const repeated = await initializeMysql(env);
  check("当前 schema 可从零初始化且重复初始化不重复迁移", initialized.migrationApplied && !repeated.migrationApplied);
  appConnection = await mysql.createConnection({ ...getMysqlConnectionOptions(config), user, password: env.MYSQL_PASSWORD, database });
  const [tables] = await appConnection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [database]);
  const initialCounts = {};
  for (const { name } of tables) {
    if (name === "schema_migrations") continue;
    const [rows] = await appConnection.query(`SELECT COUNT(*) AS count FROM \`${name.replaceAll("`", "``")}\``);
    initialCounts[name] = Number(rows[0].count);
  }
  check("注册前全部业务表为空", Object.keys(initialCounts).length > 0 && Object.values(initialCounts).every((count) => count === 0));
  await writeFile(join(outputDir, "empty-database.json"), JSON.stringify({ database, serverVersion: initialized.serverVersion, initialCounts }, null, 2));

  // 当前 Next dev 按项目目录互斥；复制当前正式输入，不停日常服务，也不复制密钥。
  await mkdir(resolve(".next"), { recursive: true });
  await mkdir(buildDir);
  workspaceCreated = true;
  await mkdir(projectDir);
  for (const name of ["src", "public", "package.json", "package-lock.json", "next.config.ts", "postcss.config.mjs"]) {
    await cp(resolve(name), join(projectDir, name), { recursive: true });
  }
  await symlink(resolve("node_modules"), join(projectDir, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  // Next dev 只改临时副本的 tsconfig 和 next-env。
  const tsconfigPath = join(projectDir, "tsconfig.json");
  const tsconfig = JSON.parse(await readFile("tsconfig.json", "utf8"));
  tsconfig.compilerOptions.baseUrl = ".";
  tsconfig.include = ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/**/*.ts"];
  tsconfig.exclude = ["node_modules"];
  await writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));
  env.V141_REPLAY_TSCONFIG = tsconfigPath;
  const serviceEnv = { ...env };
  // 网站进程不继承维护账号。
  for (const key of Object.keys(serviceEnv)) if (key.startsWith("MYSQL_ADMIN_") || key.startsWith("MYSQL_MIGRATION_")) delete serviceEnv[key];
  server = start("scripts/verify-v141-replay-foundation-server.mjs", "server", serviceEnv, projectDir);
  const base = await ready(server);
  const modeResponse = await fetch(`${base}/api/verify/replay-mode`, { signal: AbortSignal.timeout(30_000) });
  if (!modeResponse.ok) throw new Error(`隔离服务 replay 门禁返回 HTTP ${modeResponse.status}，详见 server.log`);
  const mode = await modeResponse.json();
  check("正式服务也确认 replay，发送前拒绝真实模型", modeResponse.ok && mode.aiMode === "replay");
  console.log(`基础回放开始；证据目录：${outputDir}`);
  scenario = start("scripts/verify-v141-replay-foundation-scenario.mjs", "scenario", { ...serviceEnv, BASE_URL: base });
  const timer = setTimeout(() => { scenario.kill("SIGKILL"); }, 8 * 60_000);
  let exitCode;
  try { [exitCode] = await once(scenario, "exit"); } finally { clearTimeout(timer); }
  const summary = JSON.parse(await readFile(join(outputDir, "scenario-summary.json"), "utf8"));
  pass += summary.pass;
  fail += summary.fail;
  check("连续浏览器回放完整结束", exitCode === 0 && summary.fail === 0 && summary.workflows?.length === 2);
} catch (error) {
  if (!error.counted) fail++;
  console.error(`❌ 基础回放未通过：${sanitize(error.message)}`);
} finally {
  for (const child of [scenario, server]) {
    try { await stop(child); } catch (error) { fail++; console.error(`❌ 服务清理失败：${sanitize(error.message)}`); }
  }
  // 递归删除前验证绝对路径：只允许本次随机命名的 .next 直属子目录。
  if (workspaceCreated && dirname(buildDir) === resolve(".next") && /^v141_replay_[a-f0-9]{16}$/.test(database)) {
    try { await rm(buildDir, { recursive: true, force: true }); }
    catch (error) { fail++; console.error(`❌ 本次构建目录清理失败：${sanitize(error.message)}`); }
  }
  if (appConnection) {
    try { await appConnection.end(); } catch (error) { fail++; console.error(`❌ 应用连接关闭失败：${sanitize(error.message)}`); }
  }
  if (admin) {
    if (databaseCreated) {
      try { await admin.query(`DROP DATABASE \`${database}\``); databaseRemoved = true; }
      catch (error) { fail++; console.error(`❌ 测试库清理失败：${sanitize(error.message)}`); }
    }
    if (accountCreated) {
      try { await admin.query(`DROP USER ${account}`); accountRemoved = true; }
      catch (error) { fail++; console.error(`❌ 测试账号清理失败：${sanitize(error.message)}`); }
    }
    if (databaseCreated && accountCreated && databaseRemoved && accountRemoved) check("仅清理本次创建的测试库和测试账号", true);
    await admin.end();
  }
  await writeFile(join(outputDir, "server.log"), sanitize(logs.server));
  await writeFile(join(outputDir, "scenario.log"), sanitize(logs.scenario));
  await writeFile(join(outputDir, "summary.json"), JSON.stringify({ pass, fail, outputDir, database, cleaned: databaseRemoved && accountRemoved }, null, 2));
}
console.log(`结果: ${pass} 通过, ${fail} 失败；日志与截图：${outputDir}`);
process.exit(fail > 0 ? 1 : 0);
