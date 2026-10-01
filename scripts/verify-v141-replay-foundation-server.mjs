// 仅供基础回放启动隔离的正式 Next 应用；不修改日常开发配置。
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import next from "next";

if (!process.send || process.env.AI_MODE !== "replay" || !/^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE ?? "")) {
  throw new Error("回放服务只能由独立空库入口启动");
}

const server = createServer((request, response) => {
  if (!handle) { response.writeHead(503).end(); return; }
  void handle(request, response);
});
let handle;
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;
process.env.AUTH_URL = `http://127.0.0.1:${port}`;
process.env.NEXTAUTH_URL = process.env.AUTH_URL;
const { default: projectConfig } = await import(pathToFileURL(join(process.cwd(), "next.config.ts")).href);
const app = next({
  dev: true,
  turbopack: true,
  dir: process.cwd(),
  hostname: "127.0.0.1",
  port,
  httpServer: server,
  conf: {
    ...projectConfig,
    // linked node_modules 和临时源码须在同一 Turbopack root 内。
    turbopack: { ...projectConfig.turbopack, root: process.env.V141_REPLAY_DEPENDENCY_ROOT },
    typescript: { ...projectConfig.typescript, tsconfigPath: process.env.V141_REPLAY_TSCONFIG },
    devIndicators: false,
  },
});
await app.prepare();
handle = app.getRequestHandler();
process.send({ type: "ready", port, database: process.env.MYSQL_DATABASE });

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.closeAllConnections();
  server.close();
  await app.close();
  process.exit(0);
}
process.on("message", (message) => { if (message?.type === "shutdown") void close(); });
process.on("SIGTERM", () => { void close(); });
process.on("SIGINT", () => { void close(); });
