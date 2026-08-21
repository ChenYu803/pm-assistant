// v1.1 综合固定回放验证入口。
// 用法：AI_MODE=replay node scripts/verify-v11-ux.mjs
// 前置：dev server 运行在 localhost:3000 且使用 AI_MODE=replay，MongoDB 可连。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aiMode = process.env.AI_MODE ?? "replay";
const baseUrl =
  process.env.VERIFY_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:3000";

if (aiMode !== "replay") {
  console.error("本脚本只允许 AI_MODE=replay，避免综合回归调用真实模型");
  process.exit(1);
}

if (baseUrl !== "http://localhost:3000") {
  console.error("综合入口需使用 http://localhost:3000，以复用既有验证脚本");
  process.exit(1);
}

const suites = [
  {
    name: "票01迁移后审计（文件更新、命名、空状态）",
    file: "verify-v11-ticket01-audit.mjs",
  },
  {
    name: "票02/04/07（消息操作、流式、批量确认、重生成一致性）",
    file: "verify-message-interactions.mjs",
  },
  {
    name: "票03（Agent 自我说明）",
    file: "verify-agent-types.mjs",
  },
  {
    name: "票05（编辑并重新发送）",
    file: "verify-edit-resend.mjs",
  },
  {
    name: "票06（上下文长度预警）",
    file: "verify-context-usage.mjs",
  },
  {
    name: "跨 Agent 协议安全网（marker 与冻结契约）",
    file: "verify-protocols.mjs",
  },
];

let pass = 0;
let fail = 0;

function runSuite({ name, file }) {
  const script = path.join(ROOT, "scripts", file);
  if (!fs.existsSync(script)) {
    return Promise.resolve({ name, ok: false, detail: `缺少 ${file}` });
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      env: {
        ...process.env,
        AI_MODE: "replay",
      },
      stdio: "inherit",
    });
    child.once("error", (error) => {
      resolve({ name, ok: false, detail: error.message });
    });
    child.once("exit", (code, signal) => {
      resolve({
        name,
        ok: code === 0,
        detail: signal ? `被信号 ${signal} 中断` : `退出码 ${code ?? "null"}`,
      });
    });
  });
}

async function assertReplayServer() {
  let response;
  try {
    response = await fetch(`${baseUrl}/api/verify/replay-mode`, {
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(`无法检查服务端 AI 模式：${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`服务端未提供 replay 验证状态（HTTP ${response.status}）`);
  }
  const body = await response.json();
  if (body.aiMode !== "replay") {
    throw new Error("服务端不是 AI_MODE=replay，已在调用聊天前停止验证");
  }
}

console.log("v1.1 综合回放验证（AI_MODE=replay）");
try {
  await assertReplayServer();
  console.log("✅ 服务端已确认 AI_MODE=replay");
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
for (const suite of suites) {
  console.log(`\n── ${suite.name} ──`);
  const result = await runSuite(suite);
  if (result.ok) {
    pass++;
    console.log(`✅ ${result.name}`);
  } else {
    fail++;
    console.log(`❌ ${result.name}：${result.detail}`);
  }
}

console.log(`\n综合结果: ${pass} 个专项通过, ${fail} 个专项失败`);
process.exit(fail > 0 ? 1 : 0);
