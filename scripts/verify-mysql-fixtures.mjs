// MySQL 验证夹具：只向已由公开 API 创建的测试 UUID tab / 项目写入最小历史数据。
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";

export function assertReplayEnvironment() {
  nextEnv.loadEnvConfig(process.cwd());
  if (process.env.AI_MODE !== "replay") {
    throw new Error("验证要求 AI_MODE=replay，拒绝调用真实模型");
  }
  const required = ["MYSQL_HOST", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`未运行（环境未就绪）：缺少 ${missing.join("、")}`);
  }
}

export async function assertPlaywrightAvailable(chromium, launchOptions = {}) {
  try {
    const browser = await chromium.launch({ headless: true, ...launchOptions });
    await browser.close();
  } catch (error) {
    console.error(`❌ [环境] 未运行（环境未就绪）：Playwright 浏览器不可用：${error instanceof Error ? error.message : String(error)}`);
    console.log("结果: 0 通过, 1 失败（未运行）");
    process.exit(1);
  }
}

export async function connectMysqlForVerification() {
  try {
    return await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    });
  } catch (error) {
    console.error(`❌ [环境] 未运行（环境未就绪）：MySQL 连接失败：${error instanceof Error ? error.message : String(error)}`);
    console.log("结果: 0 通过, 1 失败（未运行）");
    process.exit(1);
  }
}

export async function insertTestMessage(connection, { tabId, role, content, timestamp = new Date(), status = null }) {
  const id = randomUUID();
  await connection.execute(
    "INSERT INTO messages (id, tab_id, role, content, timestamp, status) VALUES (?, ?, ?, ?, ?, ?)",
    [id, tabId, role, content ?? "", timestamp, status],
  );
  return { id };
}

export async function insertTestProjectFile(connection, { projectId, filename, content, timestamp = new Date() }) {
  const id = randomUUID();
  await connection.execute(
    "INSERT INTO project_files (id, project_id, filename, content, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
    [id, projectId, filename, content, timestamp, timestamp],
  );
  return { id };
}
