// v1.2 #03：文件写入协议与 HTML 快照资产的外部 API/UI 验证。
// 默认只使用 replay 配置；HTML 快照通过独立资产 API 保存，不进入 ProjectFile 文件树。
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://localhost:3000";
if (process.env.AI_MODE === "live") {
  console.error("❌ #03 验证禁止 AI_MODE=live");
  process.exit(1);
}

const email = `verify-file-protocol-${Date.now()}@test.local`;
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

async function write(projectId, filename, content, agent_type = "requirement_analyst") {
  return api(`/api/projects/${projectId}/files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pm-assistant-test-system-write": "1",
    },
    body: JSON.stringify({ filename, content, agent_type }),
  });
}

try {
  await page.goto(`${BASE}/register`);
  await page.fill("#email", email);
  await page.fill('input[type="password"]', password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes("/register"), { timeout: 15000 });
  if (page.url().includes("/login")) {
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
  }

  const project = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "文件协议与快照验证" }),
  });
  check("创建验证项目", project.status === 201);
  const projectId = project.body?.id;

  const rootResults = await Promise.all([
    write(projectId, "需求分析.md", "# 需求分析"),
    write(projectId, "原型.md", "# 原型"),
    write(projectId, "prd.md", "# PRD"),
    write(projectId, "issues/01-first.md", "# 第一张票", "ticket_splitter"),
    write(projectId, "issues/v2/02-second.md", "# 第二张票", "ticket_splitter"),
  ]);
  check("根文件白名单与 issues 路径可写", rootResults.every((result) => result.status === 201));

  const invalidResults = await Promise.all([
    write(projectId, "README.md", "# 不允许"),
    write(projectId, "issues/1-short.md", "# 不允许", "ticket_splitter"),
    write(projectId, "issues/v1/01-file.txt", "不允许", "ticket_splitter"),
    write(projectId, "issues/v1/01-good.md/extra", "不允许", "ticket_splitter"),
    write(projectId, "issues/../01-traversal.md", "不允许", "ticket_splitter"),
    write(projectId, "issues/01-\u0000bad.md", "不允许", "ticket_splitter"),
    write(projectId, "issues/03-agent.md", "不允许", "unsupported_agent"),
  ]);
  check("非法路径、扩展名、路径段、控制字符和 Agent 均被拒绝", invalidResults.every((result) => result.status === 400));

  const tooLarge = write(projectId, "原型.md", "x".repeat(3 * 1024 * 1024 + 1), "prototype");
  const tooLargeResult = await tooLarge;
  check("超过 3 MiB 写入失败并明确提示", tooLargeResult.status === 413 && tooLargeResult.body?.error?.includes("3 MiB"));

  const record = await api(`/api/projects/${projectId}/work-records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "快照 tab" }),
  });
  const tab = await api(`/api/work-records/${record.body?.id}/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_type: "prototype" }),
  });
  const tabId = tab.body?.tab?.id;

  const workingDoc = await write(projectId, "需求分析-工作文档（快照 tab）.md", "# 中间过程", "requirement_analyst");
  check("中间文件允许保存", workingDoc.status === 201);
  const workingLoad = await api(`/api/tabs/${tabId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: workingDoc.body?.id }),
  });
  check("中间文件不可加载进 Agent", workingLoad.status === 400);

  const snapshot1 = await api(`/api/projects/${projectId}/snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "<!doctype html><h1>版本 1</h1>", tab_id: tabId }),
  });
  const snapshot2 = await api(`/api/projects/${projectId}/snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "<!doctype html><h1>版本 2</h1>", tab_id: tabId }),
  });
  check("HTML 快照支持多个项目版本", snapshot1.status === 201 && snapshot2.status === 201 && snapshot2.body?.version === snapshot1.body?.version + 1);
  const snapshots = await api(`/api/projects/${projectId}/snapshots`);
  const latestSnapshot = await api(`/api/projects/${projectId}/snapshots/${snapshot2.body?.id}`);
  check("HTML 快照列表可回看且含多个版本", snapshots.status === 200 && snapshots.body?.length === 2);
  check("HTML 快照正文可回看", latestSnapshot.status === 200 && latestSnapshot.body?.content?.includes("版本 2"));

  const files = await api(`/api/projects/${projectId}/files`);
  check("HTML 快照不出现在普通文件树", files.status === 200 && files.body.every((file) => !file.filename.endsWith(".html")));

  // 真实 UI 回放：原型 Agent 输出 HTML marker 后由 ChatArea 自动保存快照。
  await page.goto(`${BASE}/workspace/${record.body?.id}`);
  await page.locator("textarea").waitFor();
  await page.waitForTimeout(800);
  await page.locator("textarea").fill("请先给我一版 HTML 原型快照");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByText("HTML 原型快照已生成").waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  const snapshotsAfterChat = await api(`/api/projects/${projectId}/snapshots`);
  check(
    "原型 HTML marker 通过 UI 自动保存为快照",
    snapshotsAfterChat.status === 200 && snapshotsAfterChat.body?.length === 3,
    `status=${snapshotsAfterChat.status}, count=${snapshotsAfterChat.body?.length ?? "?"}`
  );
  const filesAfterChat = await api(`/api/projects/${projectId}/files`);
  check(
    "UI 保存 HTML 快照不污染普通文件树",
    filesAfterChat.status === 200 && filesAfterChat.body.every((file) => !file.filename.endsWith(".html"))
  );

  const requirementUpdate = await write(projectId, "需求分析.md", "## 第二条需求", "requirement_analyst");
  const ticketUpdate = await write(projectId, "issues/01-first.md", "# 第一张票\n\n更新验收标准", "ticket_splitter");
  const requirementDetail = await api(`/api/projects/${projectId}/files/${rootResults[0].body?.id}`);
  const ticketDetail = await api(`/api/projects/${projectId}/files/${rootResults[3].body?.id}`);
  check("正式需求 Markdown 追加语义保持", requirementUpdate.status === 201 && requirementDetail.body?.content?.includes("第二条需求"));
  check("既有任务 ticket 确认写入语义保持", ticketUpdate.status === 201 && ticketDetail.body?.content?.includes("更新验收标准"));
} finally {
  await browser.close();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
