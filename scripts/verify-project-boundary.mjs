// v1.2 #02：项目 ownership 与 fileId 参数隔离的外部 API 验证。
// 默认只使用 replay 配置；本脚本不发起聊天请求，也不需要真实模型。
import { chromium } from "playwright-core";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.BASE_URL || "http://localhost:3000";

if (process.env.AI_MODE === "live") {
  console.error("❌ #02 验证禁止 AI_MODE=live");
  process.exit(1);
}

const email = `verify-boundary-${Date.now()}@test.local`;
const password = "verify-pass-1234";
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}${detail ? ` (${detail})` : ""}`);
  }
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

async function api(pathname, init) {
  return page.evaluate(
    async ({ pathname: requestPath, init: requestInit }) => {
      const response = await fetch(requestPath, requestInit);
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: response.status, body };
    },
    { pathname, init }
  );
}

try {
  await page.goto(`${BASE}/register`);
  await page.fill("#email", email);
  await page.fill('input[type="password"]', password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes("/register"), {
    timeout: 15000,
  });
  if (page.url().includes("/login")) {
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 15000,
    });
  }

  const projectA = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "隔离项目 A" }),
  });
  const projectB = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "隔离项目 B" }),
  });
  check("创建项目 A/B", projectA.status === 201 && projectB.status === 201);

  const projectAId = projectA.body?.id;
  const projectBId = projectB.body?.id;
  const recordA = await api(`/api/projects/${projectAId}/work-records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "记录 A" }),
  });
  const recordB = await api(`/api/projects/${projectBId}/work-records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "记录 B" }),
  });
  const tabA = await api(`/api/work-records/${recordA.body?.id}/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_type: "requirement_analyst" }),
  });
  check("创建 A/B 记录与 A tab", recordA.status === 201 && recordB.status === 201 && tabA.status === 201);

  const fileA = await api(`/api/projects/${projectAId}/files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pm-assistant-test-system-write": "1",
    },
    body: JSON.stringify({
      filename: "需求分析.md",
      content: "# 项目 A 文件",
      agent_type: "requirement_analyst",
    }),
  });
  const fileB = await api(`/api/projects/${projectBId}/files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pm-assistant-test-system-write": "1",
    },
    body: JSON.stringify({
      filename: "需求分析.md",
      content: "# 项目 B 文件",
      agent_type: "requirement_analyst",
    }),
  });
  check("创建 A/B 文件", fileA.status === 201 && fileB.status === 201);

  const fileAId = fileA.body?.id;
  const fileBId = fileB.body?.id;
  const tabAId = tabA.body?.tab?.id;

  const sameProjectRead = await api(`/api/projects/${projectAId}/files/${fileAId}`);
  check("同项目读取保持可用", sameProjectRead.status === 200 && sameProjectRead.body?.project_id === projectAId);

  for (const [name, pathname, init] of [
    ["跨项目读取", `/api/projects/${projectAId}/files/${fileBId}`],
    ["跨项目修改", `/api/projects/${projectAId}/files/${fileBId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "不应写入" }),
    }],
    ["跨项目下载", `/api/projects/${projectAId}/files/${fileBId}/download`],
    ["跨项目润色", `/api/projects/${projectAId}/files/${fileBId}/polish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "不应润色" }),
    }],
  ]) {
    const result = await api(pathname, init);
    check(name + "被拒绝", result.status === 404, `status=${result.status}`);
  }

  const invalidId = await api(`/api/projects/${projectAId}/files/not-an-object-id`);
  const missingId = await api(
    `/api/projects/${projectAId}/files/000000000000000000000000`
  );
  check("非法 fileId 返回参数错误", invalidId.status === 400 && invalidId.body?.error === "fileId 参数无效");
  check("合法但不存在 fileId 返回资源不存在", missingId.status === 404 && missingId.body?.error !== "fileId 参数无效");

  const crossLoad = await api(`/api/tabs/${tabAId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileBId }),
  });
  const sameLoad = await api(`/api/tabs/${tabAId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileAId }),
  });
  check("项目 A tab 拒绝加载项目 B 文件", crossLoad.status === 404);
  check("项目 A tab 加载项目 A 文件", sameLoad.status === 201);

  // 通过数据库制造历史跨项目残留，再从公开 API 读取，验证残留不会进入 tab 上下文。
  const envRaw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const env = Object.fromEntries(
    envRaw
      .split("\n")
      .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
  await mongoose.connect(env.MONGODB_URI);
  const AgentFileContext = mongoose.model(
    "VerifyAgentFileContext",
    new mongoose.Schema({
      tab_id: mongoose.Schema.Types.ObjectId,
      file_id: mongoose.Schema.Types.ObjectId,
      loaded_at: Date,
    }),
    "agent_file_contexts"
  );
  await AgentFileContext.create({ tab_id: tabAId, file_id: fileBId, loaded_at: new Date() });
  await mongoose.disconnect();

  const contextList = await api(`/api/tabs/${tabAId}/files`);
  const contextIds = (contextList.body?.files || []).map((file) => file.id);
  check(
    "历史跨项目上下文不会进入公开上下文列表",
    contextList.status === 200 && contextIds.includes(fileAId) && !contextIds.includes(fileBId)
  );
} finally {
  await browser.close();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
