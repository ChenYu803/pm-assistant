// v1.41 #18：在正式页面验证桌面与窄屏完整流程；只使用确定性回放。
import { chromium } from "playwright-core";
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { getMysqlPool, closeMysqlPoolForTests } from "../src/lib/mysql.ts";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.AI_MODE !== "replay") { console.error("❌ 本验证要求 AI_MODE=replay"); process.exit(1); }
const base = process.env.BASE_URL || "http://localhost:3000";
let pass = 0; let fail = 0;
function check(name, okay) {
  if (okay) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.error(`❌ ${name}`); }
}
const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init);
    return { status: response.status, body: await response.json() };
  }, { path, init });
}
async function fitsViewport(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".workbench-shell").getBoundingClientRect();
    const nav = document.querySelector(".workbench-stage-nav").getBoundingClientRect();
    const regions = [...document.querySelectorAll(".workbench-grid > aside, .workbench-grid > section")].filter((element) => element.getClientRects().length);
    return document.documentElement.scrollWidth <= innerWidth && shell.bottom <= innerHeight + 1 && nav.top >= 0 &&
      regions.every((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.left >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1; });
  });
}
async function inViewport(locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
  });
}
await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
await mkdir(".impeccable/review", { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    // 开发指示器属于 Next 自身，不应截获正式产品底部控件的点击。
    await context.addInitScript(() => {
      const insert = () => {
        if (!document.head || document.getElementById("verify-hide-next-indicator")) return;
        const style = document.createElement("style");
        style.id = "verify-hide-next-indicator";
        style.textContent = "nextjs-portal { display: none !important; }";
        document.head.appendChild(style);
      };
      new MutationObserver(insert).observe(document, { childList: true, subtree: true });
      insert();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const prefix = `${width}px`;
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const compact = width <= 1100;
    const region = () => page.getByRole("navigation", { name: "工作台区域" });
    async function files() {
      if (compact) await region().getByRole("button", { name: /文件与上下文/ }).click();
      else if (!await page.locator(".workbench-context").isVisible()) await page.getByRole("button", { name: "展开文件区" }).click();
    }
    async function conversation() { if (compact) await region().getByRole("button", { name: "对话", exact: true }).click(); }
    async function sessions() { if (compact) await region().getByRole("button", { name: /阶段会话/ }).click(); }
    try {
      await page.goto(`${base}/register`);
      await page.fill("#email", `verify-workspace-${width}-${Date.now()}@test.local`);
      await page.locator('input[type="password"]').first().fill("verify-pass-1234");
      await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
      await page.locator('form button[type="submit"]').click();
      await page.waitForURL((url) => url.pathname === "/projects");
      const project = await api(page, "/api/projects", json({ name: "项目名称".repeat(18) }));
      const projectId = project.body.id;
      const iteration = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "工作台整合与长名称".repeat(8), goal: "验证完整成果闭环" }));
      const iterationId = iteration.body.id;
      const route = `${base}/projects/${projectId}/iterations/${iterationId}`;
      const foreign = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "其他迭代", goal: "已有任务" }));
      const folder = await api(page, `/api/iterations/${foreign.body.id}/task-folder`, json({ projectId }));
      const foreignFileId = randomUUID();
      await getMysqlPool().execute("INSERT INTO project_files (id, project_id, filename, content, version, task_folder_id, issue_number) VALUES (?, ?, ?, ?, 1, ?, 1)",
        [foreignFileId, projectId, "issues/iteration-2/01-其他迭代的任务.md", "# 只读任务", folder.body.id]);
      await page.goto(route);
      await page.locator(".workbench-grid").waitFor();
      check(`${prefix} 长产品名、四环导航和初始空阶段可见且无溢出`, await fitsViewport(page) && await page.getByRole("button", { name: "开始本阶段工作" }).isVisible());
      check(`${prefix} 打开空阶段不会自动创建会话`, (await api(page, `/api/iterations/${iterationId}/workbench`)).body.stages.every((stage) => stage.sessions.length === 0));
      await page.getByRole("button", { name: "开始本阶段工作" }).click();
      await page.getByLabel("输入消息").fill("请提出一份需求分析候选");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      const candidate = page.locator(".analysis-candidate").last();
      await candidate.getByRole("button", { name: "确认创建", exact: true }).waitFor();
      const filename = `需求分析-${"工作台长文件名".repeat(9)}.md`;
      await candidate.locator("input").fill(filename);
      check(`${prefix} 真实发送生成候选，确认前不落盘`, (await api(page, `/api/projects/${projectId}/files`)).body.filter((file) => !file.deleted).length === 1);
      await candidate.getByRole("button", { name: "预览完整 Markdown" }).click();
      check(`${prefix} 长文件名及候选预览可操作`, await candidate.locator(".analysis-candidate-preview").isVisible() && await fitsViewport(page));
      await candidate.getByRole("button", { name: "确认创建", exact: true }).click();
      await candidate.getByText("已写入", { exact: true }).waitFor();
      const directory = (await api(page, `/api/projects/${projectId}/files`)).body;
      const file = directory.find((entry) => entry.filename === filename);
      check(`${prefix} 确认创建正式项目文件`, Boolean(file));
      await page.getByLabel("输入消息").fill("保留这份尚未发送的草稿");
      await files();
      await page.getByRole("tab", { name: /项目文件树/ }).click();
      await page.getByRole("button", { name: `加入当前上下文：${filename}`, exact: true }).click();
      await page.getByRole("button", { name: `已加入当前上下文：${filename}`, exact: true }).waitFor();
      await page.getByRole("tab", { name: /当前上下文/ }).click();
      check(`${prefix} 文件树与本会话上下文明示区别`, await page.getByRole("button", { name: `从当前上下文移除 ${filename}` }).isVisible());
      await page.getByRole("button", { name: `从当前上下文移除 ${filename}` }).click();
      await page.getByText("当前上下文为空，Agent 看得到文件目录，但看不到文件正文。").waitFor();
      check(`${prefix} 可移除长名称上下文且无溢出`, await fitsViewport(page));
      await page.getByRole("tab", { name: /当前上下文/ }).focus();
      await page.keyboard.press("ArrowRight");
      check(`${prefix} 文件视图支持方向键切换`, await page.getByRole("tab", { name: "本轮写入", exact: true }).getAttribute("aria-selected") === "true");
      await page.getByRole("tab", { name: /项目文件树/ }).click();
      await page.locator(".project-tree-name").filter({ hasText: filename }).click();
      await page.getByRole("tab", { name: "文件详情与来源" }).click();
      await page.getByRole("heading", { name: "变更时间线" }).waitFor();
      check(`${prefix} 可查看永久来源与文件详情`, await page.getByText("当前路径", { exact: true }).isVisible());
      await page.getByRole("tab", { name: "正文预览" }).click();
      await page.getByRole("button", { name: "编辑正文", exact: true }).click();
      await page.getByLabel("Markdown 正文").fill("# 工作台编辑后的新版正文");
      await page.getByRole("button", { name: "保存修改" }).click();
      await page.getByText("修改已保存，可撤回到修改前的正文。").waitFor();
      await page.getByRole("button", { name: "撤回上次修改" }).click();
      await page.getByRole("button", { name: "确认撤回", exact: true }).click();
      await page.getByText("已撤回到上一版；本次撤回不能重做。").waitFor();
      check(`${prefix} 可编辑并撤回且消耗唯一备份`, await page.getByRole("button", { name: "撤回上次修改" }).isDisabled());
      await page.getByRole("button", { name: "关闭预览" }).click();
      await page.locator(".project-tree-name").filter({ hasText: "01-其他迭代的任务.md" }).click();
      await page.getByText("其他迭代任务 · 只读", { exact: true }).waitFor();
      check(`${prefix} 其他迭代任务只读且显示原因`, await page.getByRole("button", { name: "编辑正文", exact: true }).count() === 0);
      await page.getByRole("button", { name: "关闭预览" }).click();
      await conversation();
      check(`${prefix} 切换区域保留输入草稿`, await page.getByLabel("输入消息").inputValue() === "保留这份尚未发送的草稿");
      const originalSession = (await api(page, `/api/iterations/${iterationId}/workbench`)).body.stages[0].sessions[0];
      await sessions();
      const createdResponse = page.waitForResponse((response) => response.url().endsWith(`/api/iterations/${iterationId}/stages/analysis/sessions`) && response.request().method() === "POST");
      await page.getByRole("button", { name: "新建会话", exact: true }).click();
      const secondSession = (await (await createdResponse).json()).session;
      // 等待选择事实，避免把第二个会话的草稿写入还没替换的旧 textarea。
      await page.locator(`.session-row[data-session-id="${secondSession.id}"][aria-current="page"]`).waitFor({ state: "attached" });
      await page.waitForFunction(() => !document.querySelector('[aria-label="输入消息"]').disabled);
      await page.getByLabel("输入消息").fill("第二个会话的草稿");
      await sessions();
      const originalMessagesPath = `**/api/iterations/${iterationId}/stages/analysis/sessions/${originalSession.id}/messages`;
      await page.route(originalMessagesPath, (request) => request.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "消息读取暂时不可用" }) }));
      await page.locator(`.session-row[data-session-id="${originalSession.id}"]`).click();
      await page.getByRole("heading", { name: "会话内容未能加载" }).waitFor();
      check(`${prefix} 会话读取失败保持草稿并提供可达重试`, await page.getByLabel("输入消息").isDisabled() && await page.getByLabel("输入消息").inputValue() === "保留这份尚未发送的草稿" && await inViewport(page.getByRole("button", { name: "重新加载会话" })));
      await page.unroute(originalMessagesPath);
      await page.getByRole("button", { name: "重新加载会话" }).click();
      await page.getByLabel("输入消息").waitFor({ state: "visible" });
      await page.waitForFunction(() => !document.querySelector('[aria-label="输入消息"]').disabled);
      check(`${prefix} 切换会话恢复独立草稿`, await page.getByLabel("输入消息").inputValue() === "保留这份尚未发送的草稿");
      await sessions();
      await page.locator(`.session-row[data-session-id="${secondSession.id}"]`).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="输入消息"]').disabled);
      check(`${prefix} 第二个会话的独立草稿同样恢复`, await page.getByLabel("输入消息").inputValue() === "第二个会话的草稿");
      await sessions();
      await page.locator(`.session-row[data-session-id="${originalSession.id}"]`).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="输入消息"]').disabled);
      await page.getByRole("button", { name: "完成本阶段", exact: true }).click();
      await page.getByRole("button", { name: "重新打开阶段", exact: true }).waitFor();
      check(`${prefix} 完成状态限制发送且可恢复`, await page.getByLabel("输入消息").isDisabled());
      await page.getByRole("button", { name: "重新打开阶段", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="输入消息"]').disabled);
      await page.screenshot({ path: `.impeccable/review/workspace-integration-${compact ? "mobile" : "desktop"}.png`, animations: "disabled" });
      await files();
      await page.screenshot({ path: `.impeccable/review/workspace-integration-files-${compact ? "mobile" : "desktop"}.png`, animations: "disabled" });
      await conversation();
      // 用回放延迟确保生成状态稳定可见，停止后无需等待 30 秒回放完成。
      await page.route(originalMessagesPath, (request) => request.continue({ headers: { ...request.request().headers(), "x-pm-verify-stream-delay": "1" } }));
      await page.getByLabel("输入消息").fill("验证生成状态与停止入口");
      const generationResponse = page.waitForResponse((response) => response.url().endsWith(`/api/iterations/${iterationId}/stages/analysis/sessions/${originalSession.id}/messages`) && response.request().method() === "POST");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await page.getByRole("button", { name: "停止生成", exact: true }).waitFor();
      await page.waitForFunction(async (path) => {
        const response = await fetch(path); const state = await response.json();
        return state.stages[0].generatingSessionIds.length > 0;
      }, `/api/iterations/${iterationId}/workbench`);
      check(`${prefix} 生成提示不遮挡停止入口且阻止完成阶段`, await inViewport(page.getByRole("button", { name: "停止生成", exact: true })) && await page.getByRole("button", { name: "完成本阶段", exact: true }).isDisabled() && await fitsViewport(page));
      await page.getByRole("button", { name: "停止生成", exact: true }).click();
      await generationResponse;
      await page.unroute(originalMessagesPath);
      await page.waitForFunction(() => !document.querySelector('[aria-label="输入消息"]').disabled);
      check(`${prefix} 确定性回放可停止且恢复发送`, (await api(page, `/api/iterations/${iterationId}/workbench`)).body.stages[0].generatingSessionIds.length === 0);
      await page.locator(".workbench-stage-nav").getByRole("button", { name: /PRD/ }).click();
      await page.getByRole("button", { name: "继续进入PRD", exact: true }).click();
      check(`${prefix} 四环软提示后可进入无会话阶段`, await page.getByRole("button", { name: "开始本阶段工作" }).isVisible());
      await page.locator(".workbench-stage-nav").getByRole("button", { name: /需求分析/ }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="输入消息"]').disabled);
      // 故障在读取边界注入，确认失败不会伪装成空阶段。
      await page.route(`**/api/iterations/${iterationId}/workbench`, (request) => request.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "工作台暂时不可用" }) }));
      await page.reload();
      await page.getByText("工作台未能加载", { exact: true }).waitFor();
      check(`${prefix} 工作台失败保留重试入口`, await page.getByRole("button", { name: "重新加载工作台" }).isVisible());
      await page.unroute(`**/api/iterations/${iterationId}/workbench`);
      await page.getByRole("button", { name: "重新加载工作台" }).click();
      await page.locator(".workbench-grid").waitFor();
      check(`${prefix} 重试恢复正式工作台`, await fitsViewport(page));
      if (compact) {
        for (const viewport of [{ width: 320, height: 740 }, { width: 768, height: 900 }, { width: 1100, height: 800 }, { width: 844, height: 390 }, { width: 1101, height: 800 }, { width: 1280, height: 800 }]) {
          await page.setViewportSize(viewport);
          if (viewport.width <= 1100) await region().getByRole("button", { name: /文件与上下文/ }).click();
          else if (!await page.locator(".workbench-context").isVisible()) await page.getByRole("button", { name: "展开文件区" }).click();
          check(`${viewport.width}×${viewport.height} 文件区与导航在视口内`, await fitsViewport(page));
          if (viewport.width <= 1100) await region().getByRole("button", { name: "对话", exact: true }).click();
          check(`${viewport.width}×${viewport.height} 对话与发送按钮在视口内`, await fitsViewport(page) && await inViewport(page.getByRole("button", { name: "发送消息", exact: true })));
          if (viewport.width === 844 && viewport.height === 390) {
            await page.screenshot({ path: ".impeccable/review/workspace-integration-landscape.png", animations: "disabled" });
            console.log(`横屏发送按钮边界：${JSON.stringify(await page.getByRole("button", { name: "发送消息", exact: true }).boundingBox())}`);
          }
        }
      }
      check(`${prefix} 页面没有运行时错误`, errors.length === 0);
    } finally { await context.close(); }
  }
} catch (error) { check(`专项异常：${error.message}`, false); }
finally { await browser.close(); await closeMysqlPoolForTests(); }
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
