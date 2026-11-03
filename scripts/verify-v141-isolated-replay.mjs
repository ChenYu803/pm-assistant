// v1.41 专项共享：独立空库 + 正式应用 + 连续浏览器回放，不清理日常业务库。
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm, cp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";
import { seedLegacyEmailUpgrade } from "./verify-email-upgrade-fixture.mjs";
import { startEmailFixture } from "./verify-email-fixture.mjs";
import { initializeMysql } from "../src/lib/mysql-bootstrap.ts";
import { getMysqlAdminConfig, getMysqlConnectionOptions } from "../src/lib/mysql-config.ts";

export async function runIsolatedReplay({ slug, title, scenarioScript, captureProvider = false, providerFixtureUrl, expectedWorkflows = 2, seedLegacyAuth = false, emailBoundary = true, designatedAdmin = false, creditLifecycle = false, stopBillingFaults = false }) {
  if (!/^[a-z][a-z0-9-]*$/.test(slug) || !/^scripts\/verify-v14[124]-[a-z0-9-]+-scenario\.mjs$/.test(scenarioScript)) {
    throw new Error("非法专项标识或场景路径");
  }
  if (providerFixtureUrl && !/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(providerFixtureUrl)) {
    throw new Error("模型替身只允许本机随机端口 /v1");
  }
  nextEnv.loadEnvConfig(process.cwd());
  let pass = 0;
  let fail = 0;
  const outputDir = await mkdtemp(join(tmpdir(), `v141-${slug}-`));
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
  // 隔离运行不能继承真实管理员身份。
  delete env.ADMIN_EMAILS;
  if (designatedAdmin) {
    env.V144_ADMIN_EMAIL = `admin-${suffix}@test.local`;
    env.ADMIN_EMAILS = env.V144_ADMIN_EMAIL;
  }
  let emailFixture;
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
    if (seedLegacyAuth) {
      Object.assign(env, await seedLegacyEmailUpgrade(admin, database));
      secrets.push(env.V144_LEGACY_PASSWORD);
    }
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
    if (seedLegacyAuth) {
      check("增量升级只保留准备好的旧账号、项目和资料", Object.entries(initialCounts).every(([name, count]) => count === (["users", "projects", "project_files"].includes(name) ? 1 : 0)));
      const [legacy] = await appConnection.execute("SELECT email_verified_at FROM users WHERE email = ?", [env.V144_LEGACY_EMAIL]);
      check("旧账号未被虚构为已验证邮箱", legacy.length === 1 && legacy[0].email_verified_at === null);
    } else {
      check("注册前全部业务表为空", Object.keys(initialCounts).length > 0 && Object.values(initialCounts).every((count) => count === 0));
    }
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
    // 只在本次隔离副本的供应商请求边界观察实际参数，不替换正式 prompt 或 replay 输出。
    if (captureProvider) {
      const aiPath = join(projectDir, "src", "lib", "ai.ts");
      const original = await readFile(aiPath, "utf8");
      const streamStart = original.indexOf("export async function createAIStream(");
      const branch = original.indexOf("  if (!isLiveAI()) {", streamStart);
      if (streamStart < 0 || branch < 0) throw new Error("供应商边界定位失败，拒绝伪造上下文证据");
      const capture = '  appendFileSync(' + JSON.stringify(join(outputDir, "provider-requests.jsonl")) + ', JSON.stringify({ agentType, messages }) + "\\n", "utf8");\n';
      await writeFile(aiPath, 'import { appendFileSync } from "node:fs";\n' + original.slice(0, branch) + capture + original.slice(branch));
      await writeFile(join(outputDir, "provider-requests.jsonl"), "");
      await writeFile(join(outputDir, "provider-observation.json"), JSON.stringify({
        boundary: "createAIStream 入参：agentType / messages",
        sourceSha256: createHash("sha256").update(original).digest("hex"),
        observation: "仅隔离源码副本增加同步只读参数记录；不替换 prompt、输入或 replay 回复",
      }, null, 2));
    }
    // 每次回放自有邮件边界，禁止继承本机真实供应商配置。
    delete env.V144_EMAIL_TEST_URL;
    delete env.V144_EMAIL_TEST_TOKEN;
    if (emailBoundary) {
      emailFixture = await startEmailFixture();
      env.V144_EMAIL_TEST_URL = emailFixture.url;
      env.V144_EMAIL_TEST_TOKEN = emailFixture.token;
      secrets.push(emailFixture.token);
    }
    const serviceEnv = { ...env };
    delete serviceEnv.RESEND_API_KEY;
    delete serviceEnv.EMAIL_FROM;
    if (providerFixtureUrl) {
      serviceEnv.AI_MODE = "live";
      serviceEnv.AI_BASE_URL = providerFixtureUrl;
      serviceEnv.AI_API_KEY = "isolated-provider-fixture";
      serviceEnv.V144_PROVIDER_FIXTURE_URL = providerFixtureUrl;
      serviceEnv.AI_DAILY_SITE_LIMIT = "200";
      serviceEnv.AI_DAILY_USER_LIMIT = "100";
    }
    // 网站进程不继承维护账号。
    for (const key of Object.keys(serviceEnv)) if (key.startsWith("MYSQL_ADMIN_") || key.startsWith("MYSQL_MIGRATION_")) delete serviceEnv[key];
    server = start("scripts/verify-v141-replay-foundation-server.mjs", "server", serviceEnv, projectDir);
    const base = await ready(server);
    const modeResponse = await fetch(`${base}/api/verify/replay-mode`, { signal: AbortSignal.timeout(30_000) });
    if (!modeResponse.ok) throw new Error(`隔离服务 replay 门禁返回 HTTP ${modeResponse.status}，详见 server.log`);
    const mode = await modeResponse.json();
    check(providerFixtureUrl ? "隔离服务只连接本机 HTTP 模型替身" : "正式服务也确认 replay，发送前拒绝真实模型", modeResponse.ok && mode.aiMode === (providerFixtureUrl ? "live" : "replay"));
    console.log(`${title}开始；证据目录：${outputDir}`);
    scenario = start(scenarioScript, "scenario", { ...serviceEnv, AI_MODE: "replay", BASE_URL: base });
    // 仅隔离场景 IPC：构造已保护余额、重启同一份正式应用，无生产测试路由。
    let lifecycleBusy = false;
    if (creditLifecycle) scenario.on("message", async message => {
      if (lifecycleBusy || !["credit-protection-fixture", "conversation-purchase-fixture", "restart-credit-app", ...(stopBillingFaults ? ["stop-account-lock","stop-account-unlock","stop-write-fault","stop-clear-fault"] : [])].includes(message?.type)) return;
      lifecycleBusy = true;
      try {
        if (stopBillingFaults && message.type.startsWith("stop-")) {
          if (message.type === "stop-account-lock") {
            await admin.beginTransaction();
            await admin.execute(`SELECT id FROM \`${database}\`.users WHERE id=? FOR UPDATE`,[message.userId]);
          } else if (message.type === "stop-account-unlock") await admin.commit();
          else if (message.type === "stop-clear-fault") {
            for (const name of ["verify_settlement_failure","verify_polish_failure"]) await admin.query(`DROP TRIGGER IF EXISTS \`${database}\`.\`${name}\``);
          } else if (message.target === "settlement") {
            await admin.query(`CREATE TRIGGER \`${database}\`.verify_settlement_failure BEFORE INSERT ON \`${database}\`.credit_entries FOR EACH ROW BEGIN IF NEW.business_type='model_settle' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated-settlement-write-failure'; END IF; END`);
          } else if (message.target === "polish") {
            await admin.query(`CREATE TRIGGER \`${database}\`.verify_polish_failure BEFORE INSERT ON \`${database}\`.polish_generation_results FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated-polish-write-failure'`);
          } else throw new Error("未知隔离写入故障");
          scenario.send({type:message.type});
        } else if (message.type === "credit-protection-fixture") {
          const { seedProtectedCredits } = await import("./verify-credit-fixture.mjs");
          const fixture = await seedProtectedCredits(admin, database, env);
          scenario.send({ type: message.type, fixture });
        } else if (message.type === "conversation-purchase-fixture") {
          const { seedConversationPurchase } = await import("./verify-credit-fixture.mjs");
          const fixture = await seedConversationPurchase(admin,database,env);
          scenario.send({type:message.type,fixture});
        } else {
          await stop(server);
          server = start("scripts/verify-v141-replay-foundation-server.mjs", "server", serviceEnv, projectDir);
          scenario.send({ type: message.type, base: await ready(server) });
        }
      } catch { scenario.send({ type: message.type, error: "隔离生命周期操作失败，请检查测试资源。" }); }
      finally { lifecycleBusy = false; }
    });
    const timer = setTimeout(() => { scenario.kill("SIGKILL"); }, 8 * 60_000);
    let exitCode;
    try { [exitCode] = await once(scenario, "exit"); } finally { clearTimeout(timer); }
    const summary = JSON.parse(await readFile(join(outputDir, "scenario-summary.json"), "utf8"));
    if (!Number.isInteger(summary.pass) || summary.pass <= 0 || !Number.isInteger(summary.fail) || summary.fail < 0 || summary.aiMode !== "replay") {
      throw new Error("场景摘要无有效计数或 replay 身份，拒绝认定通过");
    }
    pass += summary.pass;
    fail += summary.fail;
    check("连续浏览器回放完整结束", exitCode === 0 && summary.fail === 0 && summary.workflows?.length === expectedWorkflows);
  } catch (error) {
    if (!error.counted) fail++;
    console.error(`❌ ${title}未通过：${sanitize(error.message)}`);
  } finally {
    for (const child of [scenario, server]) {
      try { await stop(child); } catch (error) { fail++; console.error(`❌ 服务清理失败：${sanitize(error.message)}`); }
    }
    if (emailFixture) {
      try { await emailFixture.close(); } catch { fail++; console.error("❌ 隔离邮件边界清理失败"); }
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
  return { pass, fail, outputDir, database, cleaned: databaseRemoved && accountRemoved };
}
