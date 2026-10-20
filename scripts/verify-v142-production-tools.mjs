// 加密备份专项：只操作本次随机空库、随机账号和临时 Git 源码；不访问真实模型。
import mysql from "mysql2/promise";
import nextEnv from "@next/env";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { initializeMysql } from "../src/lib/mysql-bootstrap.ts";
import { getMysqlAdminConfig, getMysqlAppConfig, getMysqlConnectionOptions } from "../src/lib/mysql-config.ts";
import { encryptBackup, decryptBackup, fileSha256 } from "./backup-crypto.ts";

nextEnv.loadEnvConfig(process.cwd());
const output = await mkdtemp(join(tmpdir(), "v142-production-tools-evidence-"));
const fixture = await mkdtemp(join(tmpdir(), "v142-production-tools-fixture-"));
const suffix = randomBytes(8).toString("hex");
const database = `v142_backup_${suffix}`;
const env = { ...process.env, MYSQL_DATABASE: database, MYSQL_USER: `v142_backup_${suffix}`, MYSQL_PASSWORD: randomBytes(24).toString("hex"), MYSQL_REQUIRED_VERSION: "9.7" };
const account = `${mysql.escape(env.MYSQL_USER)}@${mysql.escape(env.MYSQL_APP_HOST || "localhost")}`;
const secrets = [env.MYSQL_PASSWORD, env.MYSQL_ADMIN_PASSWORD, process.env.MYSQL_PASSWORD, process.env.AUTH_SECRET, process.env.AI_API_KEY].filter(Boolean);
const sanitize = (value) => secrets.reduce((text, secret) => text.replaceAll(secret, "<已隐藏>"), String(value));
let pass = 0; let fail = 0;
let admin; let app;
let databaseCreated = false; let userCreated = false; let restoredDatabase;
const logs = [];
function check(name, okay) { if (okay) { pass++; console.log(`✅ ${name}`); } else { fail++; const error = new Error(name); error.counted = true; throw error; } }
async function run(command, args, { cwd = process.cwd(), okay = true, childEnv = process.env } = {}) {
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (data) => { text += data; });
    child.stderr.on("data", (data) => { text += data; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolveResult({ code, text }); });
  });
  logs.push({ command, args: args.map((arg) => sanitize(arg)), ...result, text: sanitize(result.text) });
  if (okay && result.code !== 0) throw new Error(`${command} 退出 ${result.code}，详见隔离 tool.log`);
  return result;
}
const tool = (args, okay = true) => run(process.execPath, ["--import", "tsx", resolve("scripts/production-backup.ts"), ...args], { okay });
const encodeEnv = (values) => Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(String(value))}`).join("\n");
try {
  admin = await mysql.createConnection(getMysqlConnectionOptions(getMysqlAdminConfig(env)));
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  databaseCreated = true;
  await admin.query(`CREATE USER ${account} IDENTIFIED BY ${mysql.escape(env.MYSQL_PASSWORD)}`);
  userCreated = true;
  await initializeMysql(env);
  app = await mysql.createConnection(getMysqlConnectionOptions(getMysqlAppConfig(env)));
  const fixtureUserId = randomUUID();
  await app.execute("INSERT INTO users (id,email,password_hash,nickname) VALUES (?,'backup-fixture@test.local','isolated-not-a-login-hash','备份恢复夹具')", [fixtureUserId]);
  await app.execute("INSERT INTO ai_daily_usage (usage_day,subject,request_count) VALUES ('2026-10-18',?,7),('2026-10-18','site',7)", [fixtureUserId]);
  const boundaryEnv = { ...process.env, ...env, AI_MODE: "live", AI_API_KEY: "isolated-local-http-only", AI_BASE_URL: "http://127.0.0.1:1" };
  for (const name of Object.keys(boundaryEnv)) if (name.startsWith("MYSQL_ADMIN_") || name.startsWith("MYSQL_MIGRATION_")) delete boundaryEnv[name];
  const boundary = await run(process.execPath, ["--import", "tsx", resolve("scripts/verify-v142-production-preparation-ai.mjs")], { childEnv: boundaryEnv });
  const boundarySummary = JSON.parse(boundary.text.split(/\r?\n/).find((line) => line.startsWith("AI_BOUNDARY_SUMMARY=")).slice("AI_BOUNDARY_SUMMARY=".length));
  check("真实 SDK live 分支仅访问本机模拟服务并完成限额接线验收", boundarySummary.pass === 9 && boundarySummary.fail === 0 && boundarySummary.requests === 5 && boundarySummary.externalRequests === 0);
  pass += boundarySummary.pass;
  // 以下备份恢复使用固定两个计数夹具，清除本次本机 HTTP 专项占用，绝不触及日常数据库。
  await app.execute("DELETE FROM ai_daily_usage");
  await app.execute("INSERT INTO ai_daily_usage (usage_day,subject,request_count) VALUES ('2026-10-18',?,7),('2026-10-18','site',7)", [fixtureUserId]);
  const source = join(fixture, "source"); const out = join(fixture, "backups");
  await mkdir(source); await mkdir(out);
  await writeFile(join(source, "README.md"), "# 本轮隔离备份源码\n");
  await run("git", ["init", "--quiet"], { cwd: source });
  await run("git", ["add", "README.md"], { cwd: source });
  await run("git", ["-c", "user.name=Isolated verification", "-c", "user.email=verify@test.local", "commit", "--quiet", "-m", "隔离备份源码"], { cwd: source });
  const key = randomBytes(32); const keyFile = join(fixture, "backup.key");
  await writeFile(keyFile, key);
  const runtime = Object.fromEntries(Object.entries(env).filter(([name]) => /^(MYSQL_(?:HOST|PORT|DATABASE|USER|PASSWORD|APP_HOST|REQUIRED_VERSION)|AUTH_SECRET|AI_MODE)$/.test(name)));
  runtime.AI_MODE = "replay";
  const runtimeFile = join(fixture, "runtime.env"); const maintenanceFile = join(fixture, "maintenance.env");
  await writeFile(runtimeFile, encodeEnv(runtime));
  const maintenance = { ...runtime, ...Object.fromEntries(Object.entries(env).filter(([name]) => name.startsWith("MYSQL_ADMIN_"))) };
  await writeFile(maintenanceFile, encodeEnv(maintenance));
  await tool(["backup", "--env", runtimeFile, "--key", keyFile, "--out", out, "--source", source]);
  const latestFile = join(out, "latest.json");
  const latest = JSON.parse(await readFile(latestFile, "utf8"));
  const backupFile = join(out, latest.name);
  check("真实 mysqldump/git archive/tar 产生加密备份与一致校验和", latest.name.endsWith(".isb") && latest.sha256 === await fileSha256(backupFile) && (await readFile(`${backupFile}.sha256`, "utf8")).startsWith(latest.sha256));
  check("备份结束不遗留未加密临时目录", (await readdir(out)).every((name) => !name.startsWith("ideastage-backup-")));
  await tool(["inspect", "--key", keyFile, "--file", backupFile]);
  check("独立 inspect 实际解密与归档完整性校验成功", true);
  const plainFile = join(fixture, "decrypted.tar.gz");
  await decryptBackup(backupFile, plainFile, key);
  const contents = (await run("tar", ["-tzf", plainFile])).text.trim().split(/\r?\n/).sort();
  check("归档恰好包含数据库、运行配置、源码与恢复元数据", JSON.stringify(contents) === JSON.stringify(["database.sql", "metadata.json", "runtime.env", "source.tar"]));
  const extracted = join(fixture, "extracted"); await mkdir(extracted);
  await run("tar", ["-xzf", plainFile, "-C", extracted]);
  const storedRuntime = await readFile(join(extracted, "runtime.env"), "utf8");
  check("运行配置逐字节保存且未包含维护凭据/备份密钥", storedRuntime === await readFile(runtimeFile, "utf8") && !storedRuntime.includes("MYSQL_ADMIN_") && !storedRuntime.includes(key.toString("hex")));
  const fixtureCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: source })).text.trim();
  const metadata = JSON.parse(await readFile(join(extracted, "metadata.json"), "utf8"));
  check("元数据锁定实际 Git 提交和原始库名", metadata.commit === fixtureCommit && metadata.database === database);
  const exportDirectory = join(fixture, "restored-files");
  await tool(["extract", "--key", keyFile, "--file", backupFile, "--destination", exportDirectory]);
  check("extract 向不存在的新目录导出完整四成员", JSON.stringify((await readdir(exportDirectory)).sort()) === JSON.stringify(contents) && await readFile(join(exportDirectory, "runtime.env"), "utf8") === storedRuntime);
  const noOverwrite = await tool(["extract", "--key", keyFile, "--file", backupFile, "--destination", exportDirectory], false);
  check("extract 拒绝已有目录且原文件不变", noOverwrite.code !== 0 && await readFile(join(exportDirectory, "runtime.env"), "utf8") === storedRuntime);

  const restored = await tool(["restore-test", "--env", maintenanceFile, "--key", keyFile, "--file", backupFile]);
  const result = restored.text.split(/\r?\n/).filter((line) => line.startsWith('{"database":')).map((line) => JSON.parse(line))[0];
  if (result?.database && /^ideastage_restore_[a-f0-9]{16}$/.test(result.database)) restoredDatabase = result.database;
  check("恢复命令仅创建新的随机库且导入全部表", Boolean(restoredDatabase) && restoredDatabase !== database && result.counts.users === 1 && result.counts.ai_daily_usage === 2);
  const [sourceUsers] = await app.query("SELECT * FROM users ORDER BY id");
  const [restoredUsers] = await admin.query(`SELECT * FROM \`${restoredDatabase}\`.users ORDER BY id`);
  const [sourceUsage] = await app.query("SELECT * FROM ai_daily_usage ORDER BY subject");
  const [restoredUsage] = await admin.query(`SELECT * FROM \`${restoredDatabase}\`.ai_daily_usage ORDER BY subject`);
  check("恢复后账号/昵称与持久额度逐字段一致", JSON.stringify(sourceUsers) === JSON.stringify(restoredUsers) && JSON.stringify(sourceUsage) === JSON.stringify(restoredUsage));
  const [sourceMigrations] = await app.query("SELECT * FROM schema_migrations ORDER BY id");
  const [restoredMigrations] = await admin.query(`SELECT * FROM \`${restoredDatabase}\`.schema_migrations ORDER BY id`);
  check("恢复后全部 schema 迁移与校验字段保留", JSON.stringify(sourceMigrations) === JSON.stringify(restoredMigrations));
  await admin.query(`DROP DATABASE \`${restoredDatabase}\``); restoredDatabase = undefined;
  const cleanedRestore = await tool(["restore-test", "--env", maintenanceFile, "--key", keyFile, "--file", backupFile, "--cleanup-test"]);
  const cleaned = cleanedRestore.text.split(/\r?\n/).filter((line) => line.startsWith('{"database":')).map((line) => JSON.parse(line))[0];
  const [remaining] = await admin.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [cleaned.database]);
  check("恢复命令 cleanup-test 确认删除自身随机库", remaining.length === 0);

  const beforeLatest = await readFile(latestFile, "utf8");
  await writeFile(join(source, "README.md"), "未提交改动\n");
  const failedBackup = await tool(["backup", "--env", runtimeFile, "--key", keyFile, "--out", out, "--source", source], false);
  check("脏源码备份失败且成功标志保持原值", failedBackup.code !== 0 && beforeLatest === await readFile(latestFile, "utf8") && (await readdir(out)).filter((name) => name.endsWith(".isb")).length === 1);

  const tamperedFile = join(fixture, "tampered.isb"); const tampered = await readFile(backupFile); tampered[20] ^= 1;
  await writeFile(tamperedFile, tampered);
  await writeFile(`${tamperedFile}.sha256`, `${latest.sha256}  tampered.isb\n`);
  const checksumFailure = await tool(["inspect", "--key", keyFile, "--file", tamperedFile], false);
  check("密文篡改首先被 SHA-256 拒绝", checksumFailure.code !== 0 && checksumFailure.text.includes("SHA-256"));
  await writeFile(`${tamperedFile}.sha256`, `${await fileSha256(tamperedFile)}  tampered.isb\n`);
  const authenticationFailure = await tool(["inspect", "--key", keyFile, "--file", tamperedFile], false);
  check("即使伪造外层校验和仍被 GCM 认证拒绝", authenticationFailure.code !== 0);
  const failedPlain = join(fixture, "failed-plaintext"); let rejected = false;
  try { await decryptBackup(tamperedFile, failedPlain, key); } catch { rejected = true; }
  check("解密认证失败时删除不可信明文输出", rejected && !await stat(failedPlain).then(() => true, () => false));
  const wrongKey = randomBytes(32); let wrongRejected = false;
  try { await decryptBackup(backupFile, failedPlain, wrongKey); } catch { wrongRejected = true; }
  check("错误密钥无法解密且没有残留明文", wrongRejected && !await stat(failedPlain).then(() => true, () => false));
  const existing = join(fixture, "existing-output"); await writeFile(existing, "保留既有文件");
  let encryptRefused = false; let decryptRefused = false;
  try { await encryptBackup(plainFile, existing, key); } catch { encryptRefused = true; }
  try { await decryptBackup(backupFile, existing, key); } catch { decryptRefused = true; }
  check("加密/解密均拒绝覆盖现有文件", encryptRefused && decryptRefused && await readFile(existing, "utf8") === "保留既有文件");
  check("隔离原库在恢复后保持原始账号与额度", JSON.stringify((await app.query("SELECT * FROM users ORDER BY id"))[0]) === JSON.stringify(sourceUsers) && JSON.stringify((await app.query("SELECT * FROM ai_daily_usage ORDER BY subject"))[0]) === JSON.stringify(sourceUsage));
  // mock 只替代远端 scp 传输；执行真实 PowerShell 拉取脚本及哈希/过期/成功标志逻辑。
  const psHarness = join(fixture, "verify-pull.ps1");
  await writeFile(psHarness, `\ufeffparam([string]$PullScript, [string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($PullScript, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) { throw '拉取脚本存在语法错误' }
$pass = 1
function Verify([string]$Name, [bool]$Okay) { if (-not $Okay) { throw $Name }; $script:pass += 1 }
function scp {
    if ($args -notcontains 'StrictHostKeyChecking=yes' -or $args -notcontains 'BatchMode=yes') { throw 'SSH 保护参数缺失' }
    $remote = [string]$args[-2]; $destination = [string]$args[-1]
    $global:LASTEXITCODE = 0
    if ($remote.EndsWith('/latest.json')) { $global:remoteIndex | Set-Content -LiteralPath $destination -Encoding utf8; return }
    if ($global:mockMode -eq 'download-failure') { $global:LASTEXITCODE = 1; return }
    if ($global:mockMode -eq 'tamper') { [IO.File]::WriteAllBytes($destination, [byte[]](7,8,9)); return }
    [IO.File]::WriteAllBytes($destination, $global:payload)
}
$global:payload = [byte[]](1,2,3,4,5)
$payloadFile = Join-Path $FixtureRoot 'pull-fixture-payload'
[IO.File]::WriteAllBytes($payloadFile, $global:payload)
$hash = (Get-FileHash -LiteralPath $payloadFile -Algorithm SHA256).Hash.ToLowerInvariant()
$name = '2026-10-18T00-00-00-000Z-0123abcd.isb'
$global:remoteIndex = @{ name = $name; sha256 = $hash; createdAt = [datetimeoffset]::UtcNow.ToString('o') } | ConvertTo-Json
$global:mockMode = 'success'
$destination = Join-Path $FixtureRoot 'pull-destination'
& $PullScript -SshTarget 'fixture@host' -Destination $destination | Out-Null
$receipt = Get-Content -LiteralPath (Join-Path $destination 'last-pull.json') -Raw
Verify '正常拉取写入已校验备份和成功回执' ((Get-FileHash -LiteralPath (Join-Path $destination $name)).Hash.ToLowerInvariant() -eq $hash -and ($receipt | ConvertFrom-Json).sha256 -eq $hash)
& $PullScript -SshTarget 'fixture@host' -Destination $destination | Out-Null
Verify '相同文件重复拉取幂等' ((Get-FileHash -LiteralPath (Join-Path $destination $name)).Hash.ToLowerInvariant() -eq $hash)
foreach ($mode in @('tamper', 'download-failure', 'expired', 'invalid-index')) {
    $global:mockMode = $mode
    $index = @{ name = $name; sha256 = $hash; createdAt = [datetimeoffset]::UtcNow.ToString('o') }
    if ($mode -eq 'expired') { $index.createdAt = [datetimeoffset]::UtcNow.AddHours(-50).ToString('o') }
    if ($mode -eq 'invalid-index') { $index.name = '../escape.isb' }
    $global:remoteIndex = $index | ConvertTo-Json
    $before = Get-Content -LiteralPath (Join-Path $destination 'last-pull.json') -Raw
    $rejected = $false
    try { & $PullScript -SshTarget 'fixture@host' -Destination $destination | Out-Null } catch { $rejected = $true }
    Verify ('拒绝 ' + $mode + ' 且保持成功回执/备份') ($rejected -and $before -eq (Get-Content -LiteralPath (Join-Path $destination 'last-pull.json') -Raw) -and (Get-FileHash -LiteralPath (Join-Path $destination $name)).Hash.ToLowerInvariant() -eq $hash)
}
$global:mockMode = 'success'
$global:remoteIndex = @{ name = $name; sha256 = $hash; createdAt = [datetimeoffset]::UtcNow.ToString('o') } | ConvertTo-Json
$existing = Join-Path $FixtureRoot 'pull-existing'
New-Item -ItemType Directory -Path $existing | Out-Null
[IO.File]::WriteAllText((Join-Path $existing $name), '保留已有文件')
$rejected = $false
try { & $PullScript -SshTarget 'fixture@host' -Destination $existing | Out-Null } catch { $rejected = $true }
Verify '同名异内容已有文件拒绝覆盖' ($rejected -and [IO.File]::ReadAllText((Join-Path $existing $name)) -eq '保留已有文件' -and -not (Test-Path -LiteralPath (Join-Path $existing 'last-pull.json')))
Verify '所有临时拉取目录均已清理' (@(Get-ChildItem -LiteralPath $destination,$existing -Directory -Filter 'pull-*').Count -eq 0)
Write-Output ('PULL_SUMMARY=' + (@{pass=$pass;fail=0} | ConvertTo-Json -Compress))
`);
  for (const shell of process.platform === "win32" ? ["pwsh", "powershell.exe"] : ["pwsh"]) {
    const shellFixture = join(fixture, shell.replaceAll(".", "-"));
    await mkdir(shellFixture);
    const shellEnv = { ...process.env };
    // 从 pwsh 7 经 Node 启动 5.1 时不得继承 7 的 PSModulePath；计划任务由 5.1 自行建立默认模块路径。
    if (shell === "powershell.exe") delete shellEnv.PSModulePath;
    const pullResult = await run(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psHarness, "-PullScript", resolve("scripts/Pull-IdeaStageBackup.ps1"), "-FixtureRoot", shellFixture], { childEnv: shellEnv });
    const pullSummary = JSON.parse(pullResult.text.split(/\r?\n/).find((line) => line.startsWith("PULL_SUMMARY=")).slice("PULL_SUMMARY=".length));
    check(`${shell} 语法与 mock 远端拉取全部检查通过`, pullSummary.pass === 9 && pullSummary.fail === 0);
    pass += pullSummary.pass;
  }
} catch (error) {
  if (!error.counted) fail++;
  console.error(`❌ ${sanitize(error.message)}`);
} finally {
  if (app) await app.end();
  if (admin) {
    if (restoredDatabase && /^ideastage_restore_[a-f0-9]{16}$/.test(restoredDatabase)) await admin.query(`DROP DATABASE \`${restoredDatabase}\``);
    if (databaseCreated) await admin.query(`DROP DATABASE \`${database}\``);
    if (userCreated) await admin.query(`DROP USER ${account}`);
    const [dbs] = await admin.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [database]);
    const [users] = await admin.query("SELECT User FROM mysql.user WHERE User = ?", [env.MYSQL_USER]);
    check("本次隔离原库和随机账号全部清理", dbs.length === 0 && users.length === 0);
    await admin.end();
  }
  if (dirname(resolve(fixture)) !== resolve(tmpdir()) || !fixture.split(/[\\/]/).at(-1).startsWith("v142-production-tools-fixture-")) throw new Error("临时目录清理边界错误");
  await rm(fixture, { recursive: true, force: true });
  check("本次含凭据、明文和密钥的临时夹具已清理", !await stat(fixture).then(() => true, () => false));
  await writeFile(join(output, "tool.log"), JSON.stringify(logs, null, 2));
  await writeFile(join(output, "summary.json"), JSON.stringify({ pass, fail, database, fixtureRemoved: true }, null, 2));
}
console.log(`结果: ${pass} 通过, ${fail} 失败；证据：${output}`);
process.exit(fail > 0 ? 1 : 0);
