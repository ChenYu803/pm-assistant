import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export function explicitProductionEnv() {
  const index = process.argv.indexOf("--env");
  if (index < 0) return process.env;
  const file = process.argv[index + 1];
  if (!file) throw new Error("--env 后需要生产配置文件路径");
  const parsed = parseEnv(readFileSync(file, "utf8"));
  // 指定配置文件时不从本机 .env.local 读取任何连接信息。
  return { ...parsed } as NodeJS.ProcessEnv;
}
