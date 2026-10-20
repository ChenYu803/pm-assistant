import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm, rename, stat, copyFile, chmod } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { resolve, join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { explicitProductionEnv } from "./production-env";
import { getMysqlAppConfig, getMysqlConnectionOptions, getMysqlAdminConfig, mysqlVersionMatchesRequired } from "../src/lib/mysql-config";
import { encryptBackup, decryptBackup, fileSha256 } from "./backup-crypto";
import { checkProductionDatabase } from "../src/lib/mysql-production-recovery";

function option(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`缺少 ${name}`);
  return process.argv[index + 1];
}
async function run(command: string, args: string[], options: { cwd?: string; input?: string; output?: string } = {}) {
  const child = spawn(command, args, { cwd: options.cwd, windowsHide: true, stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"] });
  // stderr 可能包含路径、SQL 或连接信息，失败时仅报告工具名与退出码。
  child.stderr?.resume();
  let output = "";
  if (!options.output) child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
  const streams: Promise<unknown>[] = [];
  if (options.input) streams.push(pipeline(createReadStream(options.input), child.stdin!));
  if (options.output) streams.push(pipeline(child.stdout!, createWriteStream(options.output, { flags: "wx", mode: 0o600 })));
  const exit = new Promise<void>((resolveExit, reject) => {
    child.once("error", () => reject(new Error(`${command} 无法启动`)));
    child.once("close", (code) => code === 0 ? resolveExit() : reject(new Error(`${command} 失败（${code}）`)));
  });
  await Promise.all([exit, ...streams]);
  return output.trim();
}
function ini(value: string | number) { return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r")}"`; }
async function mysqlClientConfig(path: string, env: NodeJS.ProcessEnv, admin = false) {
  const config = admin ? getMysqlAdminConfig(env) : getMysqlAppConfig(env);
  await writeFile(path, `[client]\nhost=${ini(config.host)}\nport=${config.port}\nuser=${ini(config.user)}\npassword=${ini(config.password)}\n`, { mode: 0o600, flag: "wx" });
}

async function main() {
  const action = process.argv[2];
  if (!["backup", "inspect", "extract", "restore-test"].includes(action)) throw new Error("动作必须是 backup、inspect、extract 或 restore-test");
  const key = await readFile(resolve(option("--key")));
  if (key.length !== 32) throw new Error("备份密钥必须恰为 32 字节");
  const parent = action === "backup" ? resolve(option("--out")) : tmpdir();
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(join(parent, "ideastage-backup-"));
  try {
    if (action === "backup") {
      const env = explicitProductionEnv();
      const config = getMysqlAppConfig(env);
      const source = resolve(option("--source"));
      const dirty = await run("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: source });
      if (dirty) throw new Error("部署源码存在未提交改动，无法保证备份代码与运行版本一致");
      const commit = await run("git", ["rev-parse", "HEAD"], { cwd: source });
      const pool = mysql.createPool(getMysqlConnectionOptions(config));
      let mysqlVersion: string;
      try { mysqlVersion = await checkProductionDatabase(pool); } finally { await pool.end(); }
      const client = join(temp, "mysql.cnf");
      await mysqlClientConfig(client, env);
      await run("mysqldump", [`--defaults-extra-file=${client}`, "--single-transaction", "--quick", "--skip-lock-tables", "--no-tablespaces", "--set-gtid-purged=OFF", "--column-statistics=0", "--hex-blob", config.database], { output: join(temp, "database.sql") });
      if ((await stat(join(temp, "database.sql"))).size < 100) throw new Error("数据库导出为空或不完整");
      const envIndex = process.argv.indexOf("--env");
      if (envIndex < 0) throw new Error("备份必须显式指定 --env 生产配置文件");
      await copyFile(resolve(option("--env")), join(temp, "runtime.env"));
      await run("git", ["archive", "--format=tar", "HEAD"], { cwd: source, output: join(temp, "source.tar") });
      await writeFile(join(temp, "metadata.json"), JSON.stringify({ format: 1, createdAt: new Date().toISOString(), commit, database: config.database, node: process.version, mysql: mysqlVersion, note: "仅包含项目库，系统账号在恢复时重建；当前无额外上传目录" }, null, 2));
      // 维护凭据和加密密钥不入包；只归档明确的四个文件。
      await run("tar", ["-czf", join(temp, "bundle.tar.gz"), "-C", temp, "database.sql", "runtime.env", "metadata.json", "source.tar"]);
      const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}.isb`;
      const path = join(parent, name);
      await encryptBackup(join(temp, "bundle.tar.gz"), path, key);
      await chmod(path, 0o640);
      const sha256 = await fileSha256(path);
      await writeFile(`${path}.sha256`, `${sha256}  ${name}\n`, { flag: "wx", mode: 0o640 });
      await chmod(`${path}.sha256`, 0o640);
      const latest = { name, sha256, createdAt: new Date().toISOString(), commit };
      await writeFile(join(temp, "latest.json"), JSON.stringify(latest, null, 2), { mode: 0o640 });
      await chmod(join(temp, "latest.json"), 0o640);
      await rename(join(temp, "latest.json"), join(parent, "latest.json"));
      console.log(`✅ 已生成并校验加密备份 ${name}；仍需拉取到个人电脑才形成异地副本`);
      return;
    }
    const input = resolve(option("--file"));
    const checksum = (await readFile(`${input}.sha256`, "utf8")).split(/\s+/)[0];
    if (!/^[a-f0-9]{64}$/.test(checksum) || await fileSha256(input) !== checksum) throw new Error("备份 SHA-256 不一致");
    const archive = join(temp, "bundle.tar.gz");
    await decryptBackup(input, archive, key);
    const entries = (await run("tar", ["-tzf", archive])).split(/\r?\n/);
    const expected = ["database.sql", "runtime.env", "metadata.json", "source.tar"];
    if (entries.length !== expected.length || !expected.every((name) => entries.includes(name))) throw new Error("备份归档成员不合法");
    await run("tar", ["-xzf", archive, "-C", temp, ...expected]);
    const metadata = JSON.parse(await readFile(join(temp, "metadata.json"), "utf8"));
    if (metadata.format !== 1 || !/^[a-f0-9]{40,64}$/.test(metadata.commit)) throw new Error("备份元数据无效");
    console.log(`✅ 备份解密与完整性检查通过，生成时间 ${metadata.createdAt}，代码 ${metadata.commit}`);
    if (action === "inspect") return;
    if (action === "extract") {
      const destination = resolve(option("--destination"));
      // 恢复代码/配置到全新目录；拒绝覆盖已有文件，明文不能放入同步网盘目录。
      await mkdir(destination, { mode: 0o700 });
      try {
        for (const name of expected) await copyFile(join(temp, name), join(destination, name));
        for (const name of expected) await chmod(join(destination, name), 0o600);
      } catch (error) {
        for (const name of expected) await rm(join(destination, name), { force: true }).catch(() => {});
        throw error;
      }
      console.log("✅ 已提取至新建的私有目录；包含明文配置，恢复完成后及时移除。");
      return;
    }
    const env = explicitProductionEnv();
    // 恢复测试只使用独立管理员配置，目标库名称由工具随机生成，不接受覆盖现有库。
    const admin = getMysqlAdminConfig(env);
    const database = `ideastage_restore_${randomBytes(8).toString("hex")}`;
    const sql = await readFile(join(temp, "database.sql"), "utf8");
    if (/^\s*(?:USE\s|(?:CREATE|DROP)\s+DATABASE\s)/im.test(sql)) throw new Error("SQL 不能包含切库或创建/删除数据库指令");
    const connection = await mysql.createConnection(getMysqlConnectionOptions(admin));
    let created = false;
    try {
      const [version] = await connection.query<Array<mysql.RowDataPacket & { version: string }>>("SELECT VERSION() AS version");
      if (!mysqlVersionMatchesRequired(version[0].version, "9.7")) throw new Error("恢复工具需要 MySQL 9.7 LTS 系列");
      await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
      created = true;
      const client = join(temp, "restore.cnf");
      await mysqlClientConfig(client, env, true);
      await run("mysql", [`--defaults-extra-file=${client}`, database], { input: join(temp, "database.sql") });
      await connection.query(`USE \`${database}\``);
      const [migrations] = await connection.query<mysql.RowDataPacket[]>("SELECT id FROM schema_migrations");
      const [tables] = await connection.query<Array<mysql.RowDataPacket & { name: string }>>("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
      const counts: Record<string, number> = {};
      for (const { name } of tables) {
        if (!/^[a-z0-9_]+$/.test(name)) throw new Error("非法表名");
        const [rows] = await connection.query<Array<mysql.RowDataPacket & { count: number }>>(`SELECT COUNT(*) AS count FROM \`${name}\``);
        counts[name] = Number(rows[0].count);
      }
      if (!migrations.length || !tables.length) throw new Error("恢复库缺少迁移或项目表");
      console.log(`✅ 独立恢复完成 ${database}，${tables.length} 张表；正式库未覆盖`);
      console.log(JSON.stringify({ database, counts }));
      if (process.argv.includes("--cleanup-test")) {
        await connection.query(`DROP DATABASE \`${database}\``);
        created = false;
        console.log("✅ 已清理本次随机创建的恢复测试库");
      } else console.log("请进一步做登录/文件/聊天验收，结束后只删除上述恢复测试库。");
    } finally {
      try {
        if (created && process.argv.includes("--cleanup-test")) await connection.query(`DROP DATABASE \`${database}\``);
      } finally { await connection.end(); }
    }
  } finally {
    // 只删除本次 mkdtemp 创建的直属临时目录，不接受用户传入的递归清理路径。
    if (dirname(resolve(temp)) !== resolve(parent) || !basename(temp).startsWith("ideastage-backup-")) throw new Error("临时目录清理边界错误");
    await rm(temp, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => {
  console.error(`❌ 备份工具失败：${error instanceof Error ? error.message : "未知错误"}；没有更新成功标志。`);
  process.exitCode = 1;
});
