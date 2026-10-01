// v1.41 #20：独立空库中的正式 UI 连续回放；所有写入均由用户点击公开产品动作。
// 供应商证据来自隔离副本 createAIStream 的实际参数，不调用提示词 builder 冒充请求。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.BASE_URL;
const output = process.env.V141_REPLAY_OUTPUT_DIR;
let pass = 0; let fail = 0; let browser; let connection; let page;
const assertions = []; const workflows = []; const screenshots = []; const providerEvidence = [];
function check(name, okay) {
  assertions.push({ name, okay: Boolean(okay) });
  if (okay) { pass++; console.log(`✅ ${name}`); } else { fail++; console.error(`❌ ${name}`); }
}
function requireOkay(name, okay) { check(name, okay); if (!okay) throw new Error(`关键事实不成立：${name}`); }
async function api(path) {
  const response = await page.request.get(`${base}${path}`);
  if (!response.ok()) throw new Error(`GET ${path} 返回 ${response.status()}`);
  return response.json();
}
async function mutation(path, action, expected = 200) {
  const pending = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() !== "GET");
  await action(); const response = await pending;
  if (response.status() !== expected) throw new Error(`${response.request().method()} ${path} 返回 ${response.status()}：${await response.text()}`);
  return response.json();
}
async function eventually(read, predicate, description) {
  const end = Date.now() + 20000;
  do { const value = await read(); if (predicate(value)) return value; await new Promise((resolve) => setTimeout(resolve, 100)); } while (Date.now() < end);
  throw new Error(`等待超时：${description}`);
}
const plain = (value) => !/changelog|变更日志|%%%FILE_|%%%HTML_/i.test(value);

try {
  if (!base || !output || process.env.AI_MODE !== "replay") throw new Error("必须通过隔离 replay 入口运行");
  await mkdir(output, { recursive: true });
  const mode = await fetch(`${base}/api/verify/replay-mode`);
  requireOkay("聊天前确认服务端 AI_MODE=replay", mode.ok && (await mode.json()).aiMode === "replay");
  connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
  const [empty] = await connection.query("SELECT COUNT(*) AS total FROM users");
  requireOkay("专项开始前 MySQL 没有用户", Number(empty[0].total) === 0);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const prefix = `${viewport.width}×${viewport.height}`; const compact = viewport.width < 1100;
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.addInitScript(() => {
      const insert = () => { if (!document.head || document.getElementById("verify-hide-next-indicator")) return; const style = document.createElement("style"); style.id = "verify-hide-next-indicator"; style.textContent = "nextjs-portal { display: none !important; }"; document.head.appendChild(style); };
      new MutationObserver(insert).observe(document, { childList: true, subtree: true }); insert();
    });
    page = await context.newPage(); page.setDefaultTimeout(20000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const token = randomUUID(); const email = `verify-files-${viewport.width}-${token}@test.local`;
    await page.goto(`${base}/register`); await page.fill("#email", email);
    await page.locator('input[type="password"]').first().fill("verify-pass-1234");
    await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
    await mutation("/api/auth/register", () => page.locator('form button[type="submit"]').click(), 201);
    await page.waitForURL((url) => url.pathname === "/projects");
    check(`${prefix} 通过正式注册进入项目页`, (await api("/api/auth/session")).user.email === email);
    await page.getByRole("button", { name: "新建一个项目", exact: true }).first().click();
    const projectName = `文件专项 ${viewport.width}`;
    await page.getByRole("dialog", { name: "新建一个项目" }).getByRole("textbox").fill(projectName);
    const project = await mutation("/api/projects", () => page.getByRole("button", { name: "创建项目", exact: true }).click(), 201);
    const projectId = project.id; let iteration; let session; let currentKey = "analysis";
    const fileList = () => api(`/api/projects/${projectId}/files`);
    const history = (file) => api(`/api/projects/${projectId}/files/${file.id}/history`);
    const facts = async (file) => { const [rows] = await connection.execute("SELECT id, filename, content, previous_content, version FROM project_files WHERE id = ?", [file.id]); return rows[0]; };
    const region = () => page.getByRole("navigation", { name: "工作台区域" });
    async function conversation() { if (compact) await region().getByRole("button", { name: "对话", exact: true }).click(); }
    async function files() {
      if (compact) await region().getByRole("button", { name: /文件与上下文/ }).click();
      else if (await page.getByRole("button", { name: "展开文件区" }).isVisible()) await page.getByRole("button", { name: "展开文件区" }).click();
      await page.getByRole("tab", { name: /项目文件树/ }).click();
    }
    async function capture(name) { const path = join(output, `files-${viewport.width}-${name}.png`); await page.screenshot({ path, animations: "disabled" }); screenshots.push(path); }
    async function createIteration(name) {
      await page.goto(`${base}/projects/${projectId}`);
      await page.getByRole("button", { name: "创建产品迭代", exact: true }).first().click();
      const drawer = page.getByRole("dialog", { name: "创建产品迭代", exact: true });
      await drawer.getByPlaceholder("例如：降低首次使用流失").fill(name);
      await drawer.getByText("填写本轮目标", { exact: true }).click();
      await drawer.getByPlaceholder("这一轮最想改变什么？").fill("验证用户控制文件读取和成果写入");
      const value = await mutation(`/api/projects/${projectId}/iterations`, () => drawer.getByRole("button", { name: "创建并进入工作区" }).click(), 201);
      await page.waitForURL(`${base}/projects/${projectId}/iterations/${value.id}`);
      await page.getByRole("region", { name: "四环阶段导航" }).waitFor();
      iteration = value; currentKey = "analysis"; session = null; return value;
    }
    async function openIteration(value) {
      await page.goto(`${base}/projects/${projectId}/iterations/${value.id}`);
      await page.getByRole("region", { name: "四环阶段导航" }).waitFor(); iteration = value;
      const state = await api(`/api/iterations/${iteration.id}/workbench`); currentKey = state.currentStage;
      const selected = state.stages.find((item) => item.key === currentKey).sessions;
      session = selected[0] ?? null;
    }
    async function stage(key, label) {
      if (key !== currentKey) {
        await page.getByRole("region", { name: "四环阶段导航" }).getByRole("button", { name: new RegExp(label) }).click();
        const skip = page.getByRole("button", { name: `继续进入${label}`, exact: true });
        // 前置提示是否出现由真实 workbench 状态决定；等待目标状态或提示，避免瞬时 isVisible 猜测。
        await eventually(async () => ({ skip: await skip.isVisible(), state: await api(`/api/iterations/${iteration.id}/workbench`) }), (value) => value.skip || value.state.currentStage === key, "阶段切换或前置提示");
        if (await skip.isVisible()) await skip.click();
        await eventually(() => api(`/api/iterations/${iteration.id}/workbench`), (value) => value.currentStage === key, "目标阶段保存");
        currentKey = key;
      }
      await conversation();
      const state = await api(`/api/iterations/${iteration.id}/workbench`);
      session = state.stages.find((item) => item.key === key).sessions[0] ?? null;
      if (!session) {
        const created = await mutation(`/api/iterations/${iteration.id}/stages/${key}/sessions`, () => page.getByRole("button", { name: "开始本阶段工作" }).click(), 201); session = created.session;
      }
      await eventually(() => page.getByLabel("输入消息").isEnabled(), Boolean, "会话可输入");
      return session;
    }
    const sessionBase = () => `/api/iterations/${iteration.id}/stages/${currentKey}/sessions/${session.id}`;
    async function send(label, text = "核对当前工作范围") {
      await conversation(); await eventually(() => page.getByLabel("输入消息").isEnabled(), Boolean, "发送前可输入");
      const probe = `专项探针_${token}_${label}`; const content = `${text} ${probe}`;
      await page.getByLabel("输入消息").fill(content);
      const body = await mutation(`${sessionBase()}/messages`, () => page.getByRole("button", { name: "发送消息", exact: true }).click());
      await eventually(async () => await page.getByLabel("输入消息").isEnabled() && await page.getByRole("button", { name: "停止生成", exact: true }).count() === 0, Boolean, "回复完成");
      // 第一条消息会把“新会话”改成消息摘要；来源保留的也是写入时的正式名称。
      session.title = (await api(`/api/iterations/${iteration.id}/sessions/${session.id}`)).title;
      const records = (await readFile(join(output, "provider-requests.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const request = records.findLast((item) => item.messages?.filter((message) => message.role === "user").at(-1)?.content === content);
      requireOkay(`${prefix} ${label} 到达真实供应商参数边界`, Boolean(request));
      providerEvidence.push({ viewport, label, probe, request });
      const system = request.messages.filter((item) => item.role === "system").map((item) => item.content).join("\n");
      return { body, system, all: JSON.stringify(request.messages), message: body.messages.at(-1) };
    }
    async function decide(result, filename, operation = "create") {
      const candidate = result.message.candidate;
      requireOkay(`${prefix} ${filename} 为待确认真实候选`, candidate?.status === "pending");
      await conversation();
      const branch = currentKey === "analysis" ? "需求分析" : currentKey === "prototype" ? "原型" : "PRD";
      const card = page.getByRole("region", { name: `${branch}文件候选`, exact: true }).last();
      await card.getByLabel("文件名").fill(filename);
      await card.getByRole("button", { name: "预览完整 Markdown" }).click();
      check(`${prefix} ${filename} 确认前可预览完整 Markdown`, await card.locator(".analysis-candidate-preview h1").count() > 0);
      const before = await fileList(); const existing = before.find((item) => item.filename === filename);
      const [pendingChanges] = await connection.execute("SELECT COUNT(*) AS total FROM project_file_changes WHERE project_id = ?", [projectId]);
      check(`${prefix} ${filename} 确认前不落盘`, operation === "create" ? !existing : Boolean(existing));
      await capture(`${currentKey}-${operation}-candidate`);
      const written = await mutation(`/api/iterations/${iteration.id}/sessions/${session.id}/candidates/${candidate.id}`, () => card.getByRole("button", { name: operation === "create" ? "确认创建" : "确认覆盖", exact: true }).click());
      await card.getByText(`已保存到${branch} / ${filename}`, { exact: true }).waitFor();
      const file = (await fileList()).find((item) => item.filename === filename); const db = await facts(file); const trail = await history(file);
      const [afterChanges] = await connection.execute("SELECT COUNT(*) AS total FROM project_file_changes WHERE project_id = ?", [projectId]);
      check(`${prefix} ${filename} 用户确认才增加一条来源并进入正确树枝`, written.operation === operation && Number(afterChanges[0].total) === Number(pendingChanges[0].total) + 1 && trail.lastContentChange.actor === "agent" && trail.lastContentChange.stage === currentKey);
      check(`${prefix} ${filename} 正文与真实候选相同且不含 changelog`, db.content === candidate.content && plain(db.content));
      await files(); const branchNode = page.locator(".project-tree-branch").filter({ has: page.locator("summary span", { hasText: branch }) }).first();
      check(`${prefix} ${filename} 在${branch}树枝可见`, await branchNode.locator(".project-tree-name").filter({ hasText: filename }).count() === 1);
      return { ...file, candidateContent: candidate.content };
    }
    async function preview(file) { await files(); await page.locator(".project-tree-name").filter({ hasText: file.filename }).click(); await page.getByRole("dialog", { name: `预览 ${file.filename}`, exact: true }).waitFor(); await page.getByRole("button", { name: "编辑正文", exact: true }).waitFor(); }
    async function edit(file, content) {
      await preview(file); await page.getByRole("button", { name: "编辑正文", exact: true }).click(); await page.getByLabel("Markdown 正文").fill(content);
      await mutation(`/api/iterations/${iteration.id}/files/${file.id}`, () => page.getByRole("button", { name: "保存修改", exact: true }).click());
      await page.getByText("修改已保存，可撤回到修改前的正文。", { exact: true }).waitFor(); await page.getByRole("button", { name: "关闭预览" }).click();
    }
    async function download(file, readonly = false) {
      if (!readonly) await preview(file); else { await page.locator(".project-tree-name").filter({ hasText: file.filename }).click(); await page.getByRole("dialog", { name: `预览 ${file.filename}`, exact: true }).waitFor(); }
      const event = page.waitForEvent("download"); await page.getByRole("link", { name: `下载 ${file.filename}`, exact: true }).click(); const item = await event;
      const text = await readFile(await item.path(), "utf8"); const db = await facts(file);
      check(`${prefix} ${file.filename} ${readonly ? "只读" : ""}UI 下载为同一纯正文`, text === db.content && plain(text));
      await page.getByRole("button", { name: "关闭预览" }).click();
    }

    const first = await createIteration("首轮文件来源"); await stage("analysis", "需求分析"); const analysisSession = session;
    await files();
    check(`${prefix} 空树固定四个树枝`, (await page.locator(".project-tree-branch > summary > span:first-child").allTextContents()).join(",") === "需求分析,原型,PRD,任务拆分");
    await page.getByRole("tab", { name: /当前上下文/ }).click();
    check(`${prefix} 空上下文明确正文边界`, await page.getByText("当前上下文为空，Agent 看得到文件目录，但看不到文件正文。", { exact: true }).isVisible());
    const emptyResult = await send("初始空上下文", "生成需求分析");
    check(`${prefix} 空请求只包含项目迭代阶段与空目录`, emptyResult.system.includes(projectName) && emptyResult.system.includes(first.display_name) && emptyResult.system.includes("阶段：需求分析") && emptyResult.system.includes("（暂无项目文件）") && emptyResult.system.includes("（当前会话没有加载项目文件正文）"));
    const analysis = await decide(emptyResult, `需求分析-专项${viewport.width}.md`);
    check(`${prefix} 首次创建首修订且无旧版`, Number((await facts(analysis)).version) === 1 && (await facts(analysis)).previous_content === null);
    await stage("prototype", "原型设计"); const prototypeSession = session;
    const protoResult = await send("原型候选", "同时生成结构化原型 Markdown 和 HTML");
    check(`${prefix} 已存在的未加载需求分析只在目录出现`, protoResult.system.includes(`路径：${analysis.filename}`) && !protoResult.system.includes(analysis.candidateContent));
    const prototype = await decide(protoResult, `原型-专项${viewport.width}.md`);
    await files(); await page.getByRole("tab", { name: "HTML 快照", exact: true }).click();
    await page.locator(".snapshot-detail iframe").waitFor();
    await page.frameLocator(".snapshot-detail iframe").getByRole("heading", { name: "校园二手", exact: true }).waitFor();
    const html = await api(`/api/projects/${projectId}/snapshots`);
    check(`${prefix} HTML 自动保存为独立快照且 iframe 隔离`, html.length === 1 && await page.locator(".snapshot-detail iframe").getAttribute("sandbox") === "allow-scripts");
    check(`${prefix} HTML 内嵌预览实际呈现业务正文`, await page.frameLocator(".snapshot-detail iframe").getByRole("heading", { name: "校园二手", exact: true }).isVisible());
    const htmlDownload = page.waitForEvent("download"); await page.getByRole("link", { name: "下载 HTML", exact: true }).click(); const htmlItem = await htmlDownload;
    const htmlBody = await readFile(await htmlItem.path(), "utf8");
    check(`${prefix} HTML 可从 UI 下载`, htmlBody.includes("<!doctype html>") && htmlBody.includes("校园二手"));
    const popupEvent = page.waitForEvent("popup"); await page.getByRole("link", { name: "新窗口打开", exact: true }).click(); const popup = await popupEvent;
    await popup.getByRole("heading", { name: "校园二手", exact: true }).waitFor(); await popup.close();
    check(`${prefix} HTML 可以新窗口再次打开`, true);
    await stage("prd", "PRD"); const prdSession = session;
    const prdResult = await send("PRD候选", "详细撰写六章 PRD");
    check(`${prefix} 未加载需求分析与原型正文均未泄露`, !prdResult.system.includes(analysis.candidateContent) && !prdResult.system.includes(prototype.candidateContent));
    const prd = await decide(prdResult, `PRD-专项${viewport.width}.md`);
    for (const file of [analysis, prototype, prd]) await download(file);
    check(`${prefix} HTML 与过程文档不进入文件目录和上下文`, (await fileList()).length === 3 && (await fileList()).every((file) => file.filename.endsWith(".md") && !file.filename.includes("工作文档")) && (await api(`${sessionBase()}/context`)).fileIds.length === 0);

    // 原型保留独立的非空唯一旧版，用它验证删除来源不会丢失撤回能力。
    // 需求分析仍沿用原来的 r1..r5 / restore 链，两个假设互不干扰。
    const prototypeEdited = `${prototype.candidateContent}\n\n用户补充原型_${token}`;
    await edit(prototype, prototypeEdited);
    const prototypeBeforeDeletion = await facts(prototype);
    check(`${prefix} 删除来源前原型具有真实非空唯一上一版`, prototypeBeforeDeletion.content === prototypeEdited && prototypeBeforeDeletion.previous_content === prototype.candidateContent && Boolean(prototypeBeforeDeletion.previous_content) && Number(prototypeBeforeDeletion.version) === 2 && (await history(prototype)).canUndo);

    await stage("analysis", "需求分析");
    const oldBody = `# 用户保存的正文\n\n正文边界旧版_${token}`;
    await edit(analysis, oldBody);
    check(`${prefix} 用户编辑增加修订并保存唯一上一版`, Number((await facts(analysis)).version) === 2 && (await facts(analysis)).previous_content === analysis.candidateContent && (await history(analysis)).lastContentChange.actor === "user");
    const populatedEmpty = await send("非空目录未加载");
    check(`${prefix} 非空目录空上下文不泄露任何未加载正文`, populatedEmpty.system.includes(`路径：${analysis.filename}`) && !populatedEmpty.all.includes(oldBody) && !populatedEmpty.system.includes(prd.candidateContent) && !populatedEmpty.system.includes(prototype.candidateContent));
    await files(); await page.locator(".project-tree-name").filter({ hasText: analysis.filename }).click();
    await page.getByRole("dialog", { name: `预览 ${analysis.filename}`, exact: true }).waitFor(); await page.getByRole("button", { name: "关闭预览" }).click();
    check(`${prefix} 打开正文预览不会加入上下文`, (await api(`${sessionBase()}/context`)).fileIds.length === 0);
    await mutation(`${sessionBase()}/context`, () => page.getByRole("button", { name: `加入当前上下文：${analysis.filename}`, exact: true }).click());
    const loaded = await send("加载旧正文"); const loadedDb = await facts(analysis);
    check(`${prefix} 加载请求读取当前正文及同版来源摘要`, loaded.system.includes(oldBody) && loaded.system.includes(`### ${analysis.filename}\n当前修订：r${loadedDb.version}\n最近正文写入迭代：迭代 01`) && loaded.system.includes("可撤回：是"));
    check(`${prefix} 供应商普通对话不自动注入完整时间线`, !loaded.system.includes("变更时间线\n") && !(await history(analysis)).changes.some((item) => loaded.system.includes(item.id) || loaded.system.includes(item.occurredAt)));
    await files(); await page.getByRole("tab", { name: /当前上下文/ }).click();
    check(`${prefix} 当前上下文只列加入的一个文件且不展示修订`, await page.getByRole("button", { name: `从当前上下文移除 ${analysis.filename}`, exact: true }).isVisible() && !/当前修订：|r2\b/.test(await page.locator(".workbench-context").innerText()));
    await capture("loaded-context");

    const second = await createIteration("另一轮覆盖来源"); await stage("analysis", "需求分析");
    const overwrite = await send("跨迭代覆盖候选", "生成需求分析");
    const unchanged = await facts(analysis);
    check(`${prefix} 跨迭代覆盖候选确认前保留旧正文和修订`, unchanged.content === oldBody && Number(unchanged.version) === 2);
    await decide(overwrite, analysis.filename, "overwrite");
    check(`${prefix} 确认覆盖递增修订并替换唯一旧版`, Number((await facts(analysis)).version) === 3 && (await facts(analysis)).previous_content === oldBody && (await history(analysis)).lastContentChange.iterationNumber === 2);
    const newBody = `# 跨迭代当前正文\n\n正文边界新版_${token}`;
    await edit(analysis, newBody);
    check(`${prefix} 下一次用户保存只留下紧邻上一版`, Number((await facts(analysis)).version) === 4 && (await facts(analysis)).previous_content === analysis.candidateContent);
    await openIteration(first); await stage("analysis", "需求分析");
    check(`${prefix} 原会话仍保留文件引用`, (await api(`${sessionBase()}/context`)).fileIds.includes(analysis.id));
    const latest = await send("跨迭代更新后的下一轮");
    check(`${prefix} 原会话下一轮使用另一迭代最新正文及同版来源`, latest.system.includes(newBody) && !latest.system.includes(oldBody) && latest.system.includes(`### ${analysis.filename}\n当前修订：r4\n最近正文写入迭代：迭代 02`));
    await files(); await page.getByRole("tab", { name: /当前上下文/ }).click();
    await mutation(`${sessionBase()}/context`, () => page.getByRole("button", { name: `从当前上下文移除 ${analysis.filename}`, exact: true }).click());
    const removed = await send("移除后的下一轮");
    check(`${prefix} 移除后下一轮只读目录而无正文`, removed.system.includes(`路径：${analysis.filename}`) && !removed.all.includes(newBody) && !removed.system.includes(oldBody) && removed.system.includes("（当前会话没有加载项目文件正文）"));
    const [refs] = await connection.execute("SELECT file_id FROM iteration_session_context_files WHERE session_id = ?", [analysisSession.id]);
    check(`${prefix} 上下文 API 与 MySQL 引用均已清空`, (await api(`${sessionBase()}/context`)).fileIds.length === 0 && refs.length === 0);

    await preview(analysis); await page.getByRole("button", { name: "撤回上次修改", exact: true }).click();
    check(`${prefix} 撤回确认说明不能重做`, (await page.locator(".project-file-undo-confirm").innerText()).includes("不能重做"));
    await mutation(`/api/iterations/${iteration.id}/files/${analysis.id}`, () => page.getByRole("button", { name: "确认撤回", exact: true }).click());
    await page.getByText("已撤回到上一版；本次撤回不能重做。", { exact: true }).waitFor();
    check(`${prefix} 撤回恢复紧邻正文、增加修订并消耗备份`, (await facts(analysis)).content === analysis.candidateContent && Number((await facts(analysis)).version) === 5 && (await facts(analysis)).previous_content === null && (await history(analysis)).lastContentChange.operation === "restore" && await page.getByRole("button", { name: "撤回上次修改", exact: true }).isDisabled());
    const restoreAgain = await page.request.post(`${base}/api/iterations/${first.id}/files/${analysis.id}`, { data: { projectId, action: "restore" } });
    check(`${prefix} 公开 API 也拒绝第二次撤回且不产生重做修订`, restoreAgain.status() === 409 && Number((await facts(analysis)).version) === 5 && (await history(analysis)).changes.length === 5);
    await page.getByRole("tab", { name: "文件详情与来源", exact: true }).click(); await page.getByText("创建来源", { exact: true }).waitFor();
    check(`${prefix} 详情区分 Agent 写入与用户操作且隐藏修订`, (await page.locator(".project-file-details").innerText()).includes("Agent 写入") && (await page.locator(".project-file-details").innerText()).includes("用户操作") && !/修订 [0-9]|r5\b/.test(await page.locator(".project-file-details").innerText()));
    await capture("source-history");
    const renamedPath = `需求分析-改名${viewport.width}.md`;
    await page.getByRole("button", { name: "改名", exact: true }).click(); await page.getByLabel("新文件名", { exact: true }).fill(renamedPath);
    await mutation(`/api/iterations/${iteration.id}/files/${analysis.id}`, () => page.getByRole("button", { name: "确认改名", exact: true }).click());
    analysis.filename = renamedPath;
    check(`${prefix} 改名保留身份、正文修订和最近正文来源`, (await facts(analysis)).filename === renamedPath && Number((await facts(analysis)).version) === 5 && (await history(analysis)).changes.at(-1).operation === "rename" && (await history(analysis)).lastContentChange.operation === "restore");
    await page.getByRole("button", { name: "关闭预览" }).click();
    await page.getByRole("tab", { name: "本轮写入", exact: true }).click(); await page.locator(".iteration-write-summary li").filter({ hasText: renamedPath }).waitFor();
    check(`${prefix} 本轮写入按稳定文件身份归并操作`, (await api(`/api/iterations/${first.id}/writes`)).find((item) => item.fileId === analysis.id).filename === renamedPath);
    await preview(prd); await page.getByRole("tab", { name: "文件详情与来源", exact: true }).click(); await page.getByRole("button", { name: "删除文件", exact: true }).click();
    check(`${prefix} 文件删除确认说明正文备份和引用不可恢复`, (await page.getByRole("alertdialog", { name: "确认删除文件" }).innerText()).includes("无法恢复"));
    await mutation(`/api/iterations/${iteration.id}/files/${prd.id}`, () => page.getByRole("button", { name: "确认永久删除", exact: true }).click());
    await page.getByText("正文和上一版备份已永久删除，仅保留路径与来源记录。", { exact: true }).waitFor();
    check(`${prefix} 删除彻底移除正文并保留路径来源占位`, !(await facts(prd)) && (await history(prd)).deleted && (await history(prd)).changes.at(-1).operation === "delete" && (await history(prd)).createdBy.actor === "agent");
    const deletedDownload = await page.request.get(`${base}/api/projects/${projectId}/files/${prd.id}/download`);
    check(`${prefix} 已删除文件无法下载正文`, deletedDownload.status() === 404);
    await page.getByRole("button", { name: "关闭预览" }).click();

    await stage("analysis", "需求分析");
    if (compact) await region().getByRole("button", { name: /阶段会话/ }).click();
    await page.getByRole("button", { name: `删除会话：${analysisSession.title}`, exact: true }).click();
    check(`${prefix} 来源会话删除前明确保留文件与来源`, (await page.getByRole("alertdialog").innerText()).includes("写入时的名称快照"));
    await mutation(`/api/iterations/${first.id}/sessions/${analysisSession.id}`, () => page.getByRole("button", { name: "确认删除会话", exact: true }).click());
    const afterSession = await history(analysis);
    check(`${prefix} 会话删除保留正文及 Agent 来源名称快照`, (await facts(analysis)).content === analysis.candidateContent && afterSession.createdBy.sessionDeleted && afterSession.createdBy.sessionName === analysisSession.title);
    await files(); await page.locator(".project-tree-name").filter({ hasText: renamedPath }).click(); await page.getByRole("tab", { name: "文件详情与来源", exact: true }).click();
    await page.getByText("创建来源", { exact: true }).waitFor();
    check(`${prefix} 详情显示会话已删除占位`, (await page.locator(".project-file-details").innerText()).includes("会话已删除"));
    await page.getByRole("button", { name: "关闭预览" }).click();
    await stage("prototype", "原型设计");
    if (compact) await region().getByRole("button", { name: /阶段会话/ }).click();
    await page.getByRole("button", { name: `删除会话：${prototypeSession.title}`, exact: true }).click();
    await mutation(`/api/iterations/${first.id}/sessions/${prototypeSession.id}`, () => page.getByRole("button", { name: "确认删除会话", exact: true }).click());
    const prototypeAfterSession = await facts(prototype); const prototypeSessionHistory = await history(prototype);
    check(`${prefix} 原型来源会话删除后保留正文、非空唯一备份及来源快照`, prototypeAfterSession.content === prototypeEdited && prototypeAfterSession.previous_content === prototype.candidateContent && Number(prototypeAfterSession.version) === 2 && prototypeSessionHistory.canUndo && prototypeSessionHistory.createdBy.sessionDeleted && prototypeSessionHistory.createdBy.sessionName === prototypeSession.title);
    await page.goto(`${base}/projects/${projectId}`);
    for (const value of [first, second]) {
      const row = page.locator(`[data-iteration-id="${value.id}"]`); await row.getByRole("button", { name: /更多功能/ }).click(); await row.getByRole("button", { name: "删除产品迭代", exact: true }).click();
      await mutation(`/api/iterations/${value.id}`, () => page.getByRole("button", { name: "确认删除迭代", exact: true }).click());
      await row.waitFor({ state: "detached" });
    }
    check(`${prefix} 删除所有来源迭代仍保留正文与完整来源时间线`, (await facts(analysis)).content === analysis.candidateContent && (await history(analysis)).changes.every((item) => item.iterationDeleted && item.iterationId === null) && (await history(analysis)).changes.length === 6 && (await history(prototype)).createdBy.iterationDeleted);
    const prototypeAfterIteration = await facts(prototype); const prototypeIterationHistory = await history(prototype);
    check(`${prefix} 来源迭代删除后仍保留原型正文、非空唯一备份与可撤回事实`, prototypeAfterIteration.content === prototypeEdited && prototypeAfterIteration.previous_content === prototype.candidateContent && Number(prototypeAfterIteration.version) === 2 && prototypeIterationHistory.canUndo && prototypeIterationHistory.createdBy.iterationDeleted && prototypeIterationHistory.createdBy.iterationName === first.display_name && prototypeIterationHistory.createdBy.sessionDeleted);
    await page.getByRole("tab", { name: /项目文件树/ }).click();
    check(`${prefix} 没有当前迭代仍展示固定四树枝及删除占位`, await page.locator(".project-tree-branch").count() === 4 && await page.getByText("已删除 · 查看来源记录", { exact: true }).count() === 1);
    const readonlyBefore = JSON.stringify({ file: await facts(analysis), history: await history(analysis) });
    const forbiddenEdit = await page.request.patch(`${base}/api/projects/${projectId}/files/${analysis.id}`, { data: { content: "非法改写" } });
    const forbiddenDelete = await page.request.delete(`${base}/api/projects/${projectId}/files/${analysis.id}`);
    check(`${prefix} 无当前迭代公开旧编辑删除入口均拒绝且资产不变`, forbiddenEdit.status() === 409 && forbiddenDelete.status() === 409 && JSON.stringify({ file: await facts(analysis), history: await history(analysis) }) === readonlyBefore);
    await download(analysis, true);
    await page.locator(".project-tree-name").filter({ hasText: renamedPath }).click(); await page.getByRole("tab", { name: "文件详情与来源", exact: true }).click(); await page.getByText("创建来源", { exact: true }).waitFor();
    check(`${prefix} 无当前迭代仅可浏览详情且来源迭代不再跳转`, await page.getByRole("button", { name: "编辑正文", exact: true }).count() === 0 && await page.getByRole("button", { name: "撤回上次修改", exact: true }).count() === 0 && await page.getByRole("button", { name: "改名", exact: true }).count() === 0 && await page.getByRole("button", { name: "删除文件", exact: true }).count() === 0 && await page.getByRole("button", { name: /加入当前上下文/ }).count() === 0 && await page.locator(".file-source a").count() === 0 && (await page.locator(".project-file-details").innerText()).includes("迭代 01（已删除）"));
    await capture("readonly-source"); await page.getByRole("button", { name: "关闭预览" }).click();
    await page.locator(".project-snapshot-browser > summary").click(); await page.locator(".snapshot-detail iframe").waitFor();
    await page.frameLocator(".snapshot-detail iframe").getByRole("heading", { name: "校园二手", exact: true }).waitFor();
    check(`${prefix} 删除迭代后从项目重开 HTML 快照`, (await api(`/api/projects/${projectId}/snapshots`)).length === 1 && await page.locator(".snapshot-detail iframe").count() === 1);
    check(`${prefix} 删除来源后归档 HTML 内嵌预览仍实际呈现正文`, await page.frameLocator(".snapshot-detail iframe").getByRole("heading", { name: "校园二手", exact: true }).isVisible());
    const reopen = page.waitForEvent("popup"); await page.getByRole("link", { name: "新窗口打开", exact: true }).click(); const reopened = await reopen;
    await reopened.getByRole("heading", { name: "校园二手", exact: true }).waitFor(); await reopened.close();
    check(`${prefix} 无当前迭代 HTML 仍可再次打开`, true);
    const archivedDownload = page.waitForEvent("download"); await page.getByRole("link", { name: "下载 HTML", exact: true }).click(); const archivedHtml = await archivedDownload;
    check(`${prefix} 无当前迭代 HTML 仍可下载原正文`, await readFile(await archivedHtml.path(), "utf8") === htmlBody);
    check(`${prefix} 桌面或移动文件视图无横向溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture("readonly-html");
    const [finalFiles] = await connection.execute("SELECT id, filename, content, version, previous_content FROM project_files WHERE project_id = ?", [projectId]);
    const [finalChanges] = await connection.execute("SELECT operation, actor, content_revision, iteration_number, session_name FROM project_file_changes WHERE file_id = ? ORDER BY occurred_at, id", [analysis.id]);
    const [finalSessions] = await connection.execute("SELECT id FROM iteration_sessions WHERE iteration_id IN (?, ?)", [first.id, second.id]);
    check(`${prefix} MySQL 最终耐久文件与历史 API 事实一致`, finalFiles.length === 2 && finalFiles.every((item) => plain(item.content)) && finalChanges.length === 6 && finalChanges.filter((item) => item.actor === "agent").length === 2 && finalChanges.filter((item) => item.content_revision !== null).map((item) => Number(item.content_revision)).sort((a, b) => a - b).join(",") === "1,2,3,4,5" && finalSessions.length === 0);
    check(`${prefix} 浏览器无运行时异常`, errors.length === 0);
    workflows.push({ viewport, projectId, iterationIds: [first.id, second.id], sessionIds: [analysisSession.id, prototypeSession.id, prdSession.id], fileIds: [analysis.id, prototype.id, prd.id], snapshotId: html[0].id, finalFileCount: finalFiles.length, expectedAnalysisRevision: 5, expectedPrototypeRevision: 2, preservedPrototypeBackup: Boolean(prototypeAfterIteration.previous_content) });
    await context.close();
  }
} catch (error) {
  check(`专项回放中断：${error instanceof Error ? error.message : String(error)}`, false);
  if (page && output) await page.screenshot({ path: join(output, "file-context-failure.png"), animations: "disabled" }).catch(() => undefined);
} finally {
  if (browser) await browser.close(); if (connection) await connection.end();
  if (output) {
    await writeFile(join(output, "provider-evidence.json"), JSON.stringify(providerEvidence, null, 2), "utf8");
    await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, aiMode: "replay", workflows, screenshots, assertions }, null, 2), "utf8");
  }
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
