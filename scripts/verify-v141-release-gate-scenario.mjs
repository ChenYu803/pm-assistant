// v1.41 #24：一个场景内每个视口保持同一主账号、项目与连续产出身份。
// 不串跑旧专项；正式产出均来自 UI，MySQL 仅观察事实。
// 供应商证据来自隔离副本 createAIStream 的实际参数，不调用提示词 builder 冒充请求。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.BASE_URL;
const output = process.env.V141_REPLAY_OUTPUT_DIR;
let pass = 0; let fail = 0; let browser; let connection; let page;
const assertions = []; const workflows = []; const screenshots = []; const providerEvidence = []; const permissions = []; const evidence = []; const journeys = []; const geometry = [];
function check(name, okay) {
  assertions.push({ name, okay: Boolean(okay) });
  if (okay) { pass++; console.log(`✅ ${name}`); } else { fail++; console.error(`❌ ${name}`); }
}
function requireOkay(name, okay) { check(name, okay); if (!okay) throw new Error(`关键事实不成立：${name}`); }
async function api(path, actor = page) {
  const response = await actor.request.get(`${base}${path}`);
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
async function register(actor, email) {
  await actor.goto(`${base}/register`); await actor.fill("#email", email);
  await actor.locator('input[type="password"]').first().fill("verify-pass-1234");
  await actor.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await actor.locator('form button[type="submit"]').click(); await actor.waitForURL((url) => url.pathname === "/projects");
}
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(JSON.parse(JSON.stringify(a)))) === JSON.stringify(canonical(JSON.parse(JSON.stringify(b))));
const responseStrings = (value) => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(responseStrings) : value && typeof value === "object" ? Object.entries(value).flatMap(([key, item]) => [key, ...responseStrings(item)]) : [];
const plain = (value) => !/changelog|变更日志|%%%FILE_|%%%HTML_/i.test(value);

const issueBody = (number, token, dependency = "None") => `# ${String(number).padStart(2, "0")} — 完整任务\n\n**What to build:** 用户可以完成任务与权限核对 ${token}\n\n**Blocked by:** ${dependency}\n\n## 验收标准\n- [ ] 用户确认后看到完整结果。`;
const marker = (number, suffix, content) => `%%%FILE_BEGIN%%% issues/${String(number).padStart(2, "0")}-${suffix}.md\n${content}\n%%%FILE_END%%%`;

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
    page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(60000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const token = randomUUID(); const email = `verify-release-${viewport.width}-${token}@test.local`;
    await page.goto(`${base}/register`); await page.fill("#email", email);
    await page.locator('input[type="password"]').first().fill("verify-pass-1234");
    await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
    await mutation("/api/auth/register", () => page.locator('form button[type="submit"]').click(), 201);
    await page.waitForURL((url) => url.pathname === "/projects");
    check(`${prefix} 通过正式注册进入项目页`, (await api("/api/auth/session")).user.email === email);
    await page.goto(`${base}/profile`); await page.getByRole("button", { name: /退出登录/ }).click();
    await page.waitForURL((url) => url.pathname === "/");
    check(`${prefix} 显式退出清除认证`, !(await api("/api/auth/session"))?.user);
    await page.goto(`${base}/login`); await page.fill("#email", email); await page.fill("#password", "verify-pass-1234");
    await page.locator('form button[type="submit"]').click(); await page.waitForURL((url) => url.pathname === "/projects");
    requireOkay(`${prefix} 同一主账号登录成功`, (await api("/api/auth/session")).user.email === email);
    await page.getByRole("button", { name: "新建一个项目", exact: true }).first().click();
    const projectName = `发布闸_${viewport.width}_${token}`;
    await page.getByRole("dialog", { name: "新建一个项目" }).getByRole("textbox").fill(projectName);
    const project = await mutation("/api/projects", () => page.getByRole("button", { name: "创建项目", exact: true }).click(), 201);
    const projectId = project.id; let iteration; let session; let currentKey = "analysis";
    const journeyFailStart = fail;
    const journey = { viewport, email, projectId, events: [], completed: false }; journeys.push(journey);
    const event = (name) => journey.events.push({ name, projectId, iterationId: iteration?.id ?? null, sessionId: session?.id ?? null, stage: currentKey, occurredAt: new Date().toISOString() });
    event("注册登录与主项目创建");
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
    async function capture(name) {
      check(`${prefix} ${name}无水平溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const controls = await page.evaluate(() => Array.from(document.querySelectorAll("button, a, input, textarea")).filter((element) => {
        const rect = element.getBoundingClientRect(); const css = getComputedStyle(element);
        const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2)));
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && css.visibility === "visible" && css.display !== "none" && !element.closest('[aria-hidden="true"]') && (hit === element || element.contains(hit));
      }).map((element) => { const box = element.getBoundingClientRect(); return { label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 100) || element.getAttribute("placeholder"), left: box.left, right: box.right, top: box.top, bottom: box.bottom }; }));
      geometry.push({ viewport, name, controls });
      check(`${prefix} ${name}视口内操作控件横向完整可达`, controls.every((item) => item.left >= -1 && item.right <= viewport.width + 1));
      const path = join(output, `release-${viewport.width}-${name}.png`); await page.screenshot({ path, animations: "disabled" }); if (!screenshots.includes(path)) screenshots.push(path);
    }
    async function createProject(name) {
      await page.goto(`${base}/projects`); await page.getByRole("button", { name: "新建一个项目", exact: true }).first().click();
      await page.getByRole("dialog", { name: "新建一个项目" }).getByRole("textbox").fill(name);
      return mutation("/api/projects", () => page.getByRole("button", { name: "创建项目", exact: true }).click(), 201);
    }
    async function openProject(targetProject = projectId) {
      // /projects/[id] 已是旧地址，只跳转列表；必须明确点击目标项目。
      const targetName = targetProject === projectId ? projectName : (await api(`/api/projects/${targetProject}`)).name;
      await page.goto(`${base}/projects`); await page.getByRole("button", { name: targetName, exact: true }).click();
      await page.getByRole("heading", { name: targetName, exact: true }).waitFor();
    }
    async function createIteration(name, targetProject = projectId) {
      await openProject(targetProject);
      await page.getByRole("button", { name: "创建产品迭代", exact: true }).first().click();
      const drawer = page.getByRole("dialog", { name: "创建产品迭代", exact: true });
      check(`${prefix} 新建目标没有默认选择`, await drawer.getByRole("radio", { checked: true }).count() === 0);
      await drawer.getByPlaceholder("例如：降低首次使用流失").fill(name);
      await drawer.getByText("填写本轮目标", { exact: true }).click();
      await drawer.getByPlaceholder("这一轮最想改变什么？").fill("验证用户控制文件读取和成果写入");
      const value = await mutation(`/api/projects/${targetProject}/iterations`, () => drawer.getByRole("button", { name: "创建并进入工作区" }).click(), 201);
      await page.waitForURL(`${base}/projects/${targetProject}/iterations/${value.id}`);
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
      const available = state.stages.find((item) => item.key === key).sessions;
      session = null;
      if (available.length) {
        const selectedId = await eventually(async () => page.locator('[data-session-id][aria-current="page"]').count() ? page.locator('[data-session-id][aria-current="page"]').getAttribute("data-session-id") : null, (id) => available.some((item) => item.id === id), "使用界面当前选择的会话，而非最近更新时间排序");
        session = available.find((item) => item.id === selectedId);
      }
      if (!session) {
        const created = await mutation(`/api/iterations/${iteration.id}/stages/${key}/sessions`, () => page.getByRole("button", { name: "开始本阶段工作" }).click(), 201); session = created.session;
      }
      await eventually(() => page.getByLabel("输入消息").isEnabled(), Boolean, "会话可输入");
      return session;
    }
    async function probe(path, method = "GET", data, headers = {}, actor = page) {
      const response = await actor.request.fetch(`${base}${path}`, { method, data, headers, timeout: 60000 });
      const text = await response.text(); return { status: response.status(), body: text ? JSON.parse(text) : null };
    }
    const root = () => `/api/iterations/${iteration.id}`;
    async function processState() {
      const state = {};
      state.product_iterations = (await connection.execute("SELECT * FROM product_iterations WHERE project_id = ? ORDER BY id", [projectId]))[0];
      for (const table of ["iteration_stage_states", "iteration_sessions"]) state[table] = (await connection.execute(`SELECT * FROM ${table} WHERE iteration_id IN (SELECT id FROM product_iterations WHERE project_id = ?) ORDER BY ${table === "iteration_stage_states" ? "iteration_id, stage" : "id"}`, [projectId]))[0];
      for (const table of ["iteration_session_messages", "iteration_session_context_files", "iteration_file_candidates", "iteration_task_set_candidates"]) state[table] = (await connection.execute(`SELECT * FROM ${table} WHERE session_id IN (SELECT s.id FROM iteration_sessions s JOIN product_iterations i ON s.iteration_id = i.id WHERE i.project_id = ?) ORDER BY ${table === "iteration_session_context_files" ? "session_id, file_id" : "id"}`, [projectId]))[0];
      return state;
    }
    const folderPath = () => `/api/iterations/${iteration.id}/task-folder`;
    const proposalPath = () => `/api/iterations/${iteration.id}/sessions/${session.id}/task-candidates`;
    const candidatePath = (id) => `${proposalPath()}/${id}`;
    const tasks = () => stage("tickets", "任务拆分");
    async function assets() {
      const facts = {};
      for (const table of ["project_files", "task_folders", "prototype_snapshots", "project_file_changes"]) facts[table] = (await connection.execute(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY id`, [projectId]))[0];
      return facts;
    }
    const issues = async () => (await connection.execute("SELECT * FROM project_files WHERE project_id = ? ORDER BY issue_number", [projectId]))[0];
    const current = async (folderId) => (await issues()).filter((file) => file.task_folder_id === folderId);
    const snapItems = (rows) => rows.map((row) => ({ id: row.id, issue_number: Number(row.issue_number), filename: row.filename, content: row.content, version: Number(row.version) }));
    const sessionBase = () => `/api/iterations/${iteration.id}/stages/${currentKey}/sessions/${session.id}`;
    async function send(label, text = currentKey === "tickets" ? "确认并输出完整任务集合" : "核对当前工作范围", expected = 200, faultHeader) {
      await conversation(); await eventually(() => page.getByLabel("输入消息").isEnabled(), Boolean, "发送前可输入");
      const probe = `发布闸探针_${token}_${label}`; const content = `${text} ${probe}`;
      if (faultHeader) await page.route(`${base}${sessionBase()}/messages`, (route) => route.continue({ headers: { ...route.request().headers(), [faultHeader]: "1" } }), { times: 1 });
      await page.getByLabel("输入消息").fill(content);
      const body = await mutation(`${sessionBase()}/messages`, () => page.getByRole("button", { name: "发送消息", exact: true }).click(), expected);
      await eventually(async () => await page.getByLabel("输入消息").isEnabled() && await page.getByRole("button", { name: "停止生成", exact: true }).count() === 0, Boolean, "回复完成");
      // 第一条消息会把“新会话”改成消息摘要；来源保留的也是写入时的正式名称。
      session.title = (await api(`/api/iterations/${iteration.id}/sessions/${session.id}`)).title;
      const records = (await readFile(join(output, "provider-requests.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const request = records.findLast((item) => item.messages?.filter((message) => message.role === "user").at(-1)?.content === content);
      requireOkay(`${prefix} ${label} 到达真实供应商参数边界`, Boolean(request));
      providerEvidence.push({ viewport, label, probe, request });
      const system = request.messages.filter((item) => item.role === "system").map((item) => item.content).join("\n");
      event(`供应商边界：${label}`);
      return { body, system, all: JSON.stringify(request.messages), message: body.messages.at(-1) };
    }
    async function decide(result, filename, operation = "create") {
      const candidate = result.message.candidate;
      event(`普通候选${operation}`);
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
      if (currentKey === "analysis") {
        const path = `/api/iterations/${iteration.id}/sessions/${session.id}/candidates/${candidate.id}`;
        const beforeFault = await assets();
        const [beforeCandidate] = await connection.execute("SELECT * FROM iteration_file_candidates WHERE id = ?", [candidate.id]);
        await page.route(`${base}${path}`, (route) => route.continue({ headers: { ...route.request().headers(), "x-pm-verify-candidate-write-fail": "1" } }), { times: 1 });
        await mutation(path, () => card.getByRole("button", { name: operation === "create" ? "确认创建" : "确认覆盖", exact: true }).click(), 500);
        const [afterCandidate] = await connection.execute("SELECT * FROM iteration_file_candidates WHERE id = ?", [candidate.id]);
        requireOkay(`${prefix} 普通${operation}事务失败无半成品且候选原样可重试`, equal(beforeFault, await assets()) && equal(beforeCandidate, afterCandidate) && await card.getByRole("button", { name: operation === "create" ? "确认创建" : "确认覆盖", exact: true }).isEnabled());
        evidence.push({ viewport, type: `ordinary-${operation}-rollback`, before: beforeFault, after: await assets() });
        await capture(`${operation}-failure-retry`);
      }
      const written = await mutation(`/api/iterations/${iteration.id}/sessions/${session.id}/candidates/${candidate.id}`, () => card.getByRole("button", { name: operation === "create" ? "确认创建" : "确认覆盖", exact: true }).click());
      await card.getByText(`已保存到${branch} / ${filename}`, { exact: true }).waitFor();
      const afterFirstWrite = await assets();
      const duplicate = await page.request.post(`${base}/api/iterations/${iteration.id}/sessions/${session.id}/candidates/${candidate.id}`, { data: { action: "write", filename, expectedOperation: operation } });
      requireOkay(`${prefix} ${filename}重复确认精确409且修订来源不重复`, duplicate.status() === 409 && equal(afterFirstWrite, await assets()));
      const file = (await fileList()).find((item) => item.filename === filename); const db = await facts(file); const trail = await history(file);
      const [afterChanges] = await connection.execute("SELECT COUNT(*) AS total FROM project_file_changes WHERE project_id = ?", [projectId]);
      check(`${prefix} ${filename} 用户确认才增加一条来源并进入正确树枝`, written.operation === operation && Number(afterChanges[0].total) === Number(pendingChanges[0].total) + 1 && trail.lastContentChange.actor === "agent" && trail.lastContentChange.stage === currentKey);
      check(`${prefix} ${filename} 正文与真实候选相同且不含 changelog`, db.content === candidate.content && plain(db.content));
      await files(); const branchNode = page.locator(".project-tree-branch").filter({ has: page.locator("summary span", { hasText: branch }) }).first();
      check(`${prefix} ${filename} 在${branch}树枝可见`, await branchNode.locator(".project-tree-name").filter({ hasText: filename }).count() === 1);
      return { ...file, candidateContent: candidate.content };
    }
    const card = () => page.getByRole("region", { name: "任务集合候选", exact: true }).last();
    async function readyReview(id) {
      const review = await api(candidatePath(id));
      const paths = [...review.entries, ...review.deleted].map((item) => item.filename).sort();
      // 创建接口先返回，消息和卡片随后刷新；核对真实整套路径，避免点击旧候选。
      await eventually(async () => ({ paths: (await card().locator(".task-set-row-head strong").allTextContents()).sort(), status: await card().locator("[data-status]").getAttribute("data-status") }), (value) => value.status === review.status && equal(value.paths, paths), "目标候选完整差异进入真实界面");
      return review;
    }
    async function failOnce(path, action) {
      let intercepted = 0;
      await page.route(`${base}${path}`, async (route) => {
        if (route.request().method() === "GET") return route.continue();
        intercepted++;
        return route.continue({ headers: { ...route.request().headers(), "x-pm-assistant-test-task-failure": "1" } });
      }, { times: 1 });
      await mutation(path, action, 500); requireOkay(`${prefix} 故障仅注入本次公开 mutation 一次`, intercepted === 1);
    }
    async function commit(id, failureLabel) {
      await conversation(); await readyReview(id); await card().getByRole("button", { name: "确认整套提交", exact: true }).waitFor();
      if (failureLabel) {
        const before = await assets();
        await failOnce(candidatePath(id), () => card().getByRole("button", { name: "确认整套提交", exact: true }).click());
        requireOkay(`${prefix} ${failureLabel}失败所有资产字段、快照、序号和来源完全不变`, equal(before, await assets()));
        requireOkay(`${prefix} ${failureLabel}失败候选 pending 且可重试`, (await api(candidatePath(id))).status === "pending" && await card().getByText(/候选仍保留，可重试/).isVisible() && await card().getByRole("button", { name: "确认整套提交", exact: true }).isEnabled());
        await capture(`${failureLabel}-retry`);
      }
      const result = await mutation(candidatePath(id), () => card().getByRole("button", { name: "确认整套提交", exact: true }).click());
      await card().getByText("整套任务已提交到本迭代文件夹。", { exact: true }).waitFor(); return result;
    }
    async function restore(fault = false, deletedFile = null) {
      await files();
      if (deletedFile) await eventually(() => page.getByTitle(deletedFile.filename, { exact: true }).and(page.locator("button.project-tree-name")).getAttribute("class"), (value) => Boolean(value?.split(/\s+/).includes("deleted")), "删除占位已进入公开文件树");
      await page.getByRole("button", { name: "撤回上次任务修改", exact: true }).click();
      await page.getByText("撤回会消耗唯一旧集合，本次撤回不能重做。", { exact: true }).waitFor();
      if (fault) {
        await capture("restore-confirm");
        const before = await assets(); await failOnce(folderPath(), () => page.getByRole("button", { name: "确认撤回整套", exact: true }).click());
        requireOkay(`${prefix} 撤回失败全部资产、快照、序号和来源完全不变`, equal(before, await assets()));
        await capture("restore-retry");
      }
      let releaseDirectory; let intercepted = false;
      if (deletedFile) {
        const gate = new Promise((resolve) => { releaseDirectory = resolve; });
        await page.route(`${base}/api/projects/${projectId}/files`, async (route) => {
          const response = await route.fetch(); intercepted = true; await gate; await route.fulfill({ response });
        }, { times: 1 });
      }
      try {
        const result = await mutation(folderPath(), () => page.getByRole("button", { name: "确认撤回整套", exact: true }).click());
        await page.getByText("整套任务已恢复。旧集合已消耗，本次撤回不能重做。", { exact: true }).waitFor();
        if (deletedFile) {
          await eventually(async () => intercepted, Boolean, "目录刷新被受控gate暂停");
          const stale = page.getByTitle(deletedFile.filename, { exact: true }).and(page.locator("button.project-tree-name"));
          requireOkay(`${prefix} 回归确实在旧删除占位仍显示时点击`, (await stale.getAttribute("class")).split(/\s+/).includes("deleted"));
          await stale.click(); await page.getByRole("dialog", { name: `详情 ${deletedFile.filename}`, exact: true }).waitFor();
          releaseDirectory();
          await page.getByRole("tab", { name: "正文预览", exact: true }).waitFor(); await page.getByRole("tab", { name: "正文预览", exact: true }).click();
          const title = deletedFile.content.split("\n")[0].replace(/^#+\s*/, "");
          await eventually(() => page.locator(".project-file-preview-body").innerText(), (text) => text.includes(title), "恢复后的正文无需关闭重开即可预览");
          check(`${prefix} 目录恢复后当前弹窗立即变为可预览可编辑`, await page.getByRole("button", { name: "编辑正文", exact: true }).isVisible());
          await capture("restored-open-file"); await page.getByRole("button", { name: "关闭预览", exact: true }).click();
        }
        return result;
      } finally { releaseDirectory?.(); }
    }
    async function mixed(first, newBody, suffix, dependency = "#01") {
      await conversation(); await page.getByRole("button", { name: "手动提出整套任务", exact: true }).click();
      await page.locator("#task-body-1").fill(newBody); await page.locator("#task-suffix-1").fill(suffix);
      await page.locator(".task-manual-file").filter({ has: page.locator("#task-body-2") }).getByRole("button", { name: "从候选移除" }).click();
      await page.getByRole("button", { name: "新增 issue", exact: true }).click();
      const item = page.locator(".task-manual-file").last(); await item.getByLabel("文件名描述").fill(`新增秘密_${token}`);
      await item.getByLabel("完整 Markdown 正文").fill(issueBody(3, token, dependency));
      check(`${prefix} 手动编辑只提供后缀且已有系统编号保持`, (await page.locator(".task-manual-file-heading").first().innerText()).includes("issue 01") && await page.locator("#task-suffix-1").inputValue() === suffix);
      await capture("manual-editor");
      const result = await mutation(proposalPath(), () => page.getByRole("button", { name: "生成整套待确认候选", exact: true }).click(), 201);
      const review = await readyReview(result.candidateId);
      requireOkay(`${prefix} 混合候选包含更新正文及改名、新增和删除`, review.entries.some((entry) => entry.change === "content-and-rename") && review.entries.some((entry) => entry.change === "create") && review.deleted.length === 1 && review.deleted[0].id === first[1].id);
      await card().getByRole("button", { name: "预览正文", exact: true }).first().click();
      check(`${prefix} 混合差异正文可审阅且只可整体确认或放弃`, (await card().locator(".analysis-candidate-preview").innerText()).includes(token) && await card().getByRole("button", { name: "确认整套提交", exact: true }).count() === 1 && await card().getByRole("button", { name: "放弃整套候选", exact: true }).count() === 1 && await card().locator(".task-set-row button").count() === 2);
      await capture("mixed-candidate"); return result.candidateId;
    }
    async function preview(file) {
      await files(); const target = page.getByTitle(file.filename, { exact: true }).and(page.locator("button.project-tree-name"));
      await eventually(() => target.getAttribute("class"), (value) => value !== null && !value.split(/\s+/).includes("deleted"), "完整title路径对应的文件已完成恢复对账");
      await target.click(); await page.getByRole("dialog", { name: `预览 ${file.filename}`, exact: true }).waitFor();
    }
    async function edit(file, content) {
      await preview(file); await page.getByRole("button", { name: "编辑正文", exact: true }).click(); await page.getByLabel("Markdown 正文").fill(content);
      if (file.filename.startsWith("原型")) {
        const path = `/api/iterations/${iteration.id}/files/${file.id}`; const before = await assets();
        await page.route(`${base}${path}`, (route) => route.continue({ headers: { ...route.request().headers(), "x-pm-assistant-test-file-revision-failure": "1" } }), { times: 1 });
        await mutation(path, () => page.getByRole("button", { name: "保存修改", exact: true }).click(), 500);
        requireOkay(`${prefix} 用户编辑事务失败正文旧版修订来源全部不变`, equal(before, await assets()));
        evidence.push({ viewport, type: "ordinary-edit-rollback", before, after: await assets() });
      }
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

    const first = await createIteration("首轮文件来源");
    requireOkay(`${prefix} 首轮填写目标且稳定编号1`, first.goal && first.iteration_number === 1);
    await openProject();
    const listPath = `/api/projects/${projectId}/iterations`;
    await page.getByRole("button", { name: "创建产品迭代", exact: true }).first().click();
    const drawer = page.getByRole("dialog", { name: "创建产品迭代", exact: true });
    await drawer.getByPlaceholder("例如：降低首次使用流失").fill("暂不填目标的第二轮");
    await drawer.getByText("填写本轮目标", { exact: true }).click();
    const draftGoal = "返回后需要保留的目标草稿";
    await drawer.getByPlaceholder("这一轮最想改变什么？").fill(draftGoal);
    await drawer.getByText("暂不填写", { exact: true }).click();
    const risk = page.getByRole("dialog", { name: "暂不填写本轮目标？", exact: true });
    await risk.waitFor();
    check(`${prefix} 暂不填写先明确展示已知与未知边界`, await risk.getByText("Agent 已知", { exact: true }).isVisible() && await risk.getByText("Agent 未知", { exact: true }).isVisible());
    await risk.getByRole("button", { name: "返回重新选择" }).click();
    check(`${prefix} 风险返回保留选择与名称`, await drawer.getByRole("radio", { name: /暂不填写/ }).isChecked() && await drawer.getByPlaceholder("例如：降低首次使用流失").inputValue() === "暂不填目标的第二轮");
    await drawer.getByText("填写本轮目标", { exact: true }).click();
    check(`${prefix} 风险返回保留目标草稿`, await drawer.getByPlaceholder("这一轮最想改变什么？").inputValue() === draftGoal);
    await drawer.getByText("暂不填写", { exact: true }).click();
    await risk.getByRole("button", { name: "确认暂不填写" }).click();
    // 再切换一次选项，证明确认在本次创建中生效且不会重复弹窗。
    await drawer.getByText("填写本轮目标", { exact: true }).click();
    await drawer.getByText("暂不填写", { exact: true }).click();
    check(`${prefix} 确认后本次创建不重复警告`, !await risk.isVisible());
    const second = await mutation(listPath, () => drawer.getByRole("button", { name: "创建并进入工作区" }).click(), 201);
    await page.waitForURL(`${base}/projects/${projectId}/iterations/${second.id}`);
    check(`${prefix} 第二轮目标为空且编号递增`, second.goal === null && second.iteration_number === 2);
    await page.getByRole("link", { name: "返回迭代管理" }).click();

    await openProject();
    const firstRow = page.locator(`[data-iteration-id="${first.id}"]`); await firstRow.getByRole("button", { name: "编辑迭代" }).click();
    const renameDrawer = page.getByRole("dialog", { name: "编辑产品迭代" });
    check(`${prefix} 稳定编号字段只读`, await renameDrawer.getByLabel("稳定编号").isDisabled());
    await renameDrawer.getByPlaceholder("例如：降低首次使用流失").fill("首轮文件来源更名");
    Object.assign(first, await mutation(`/api/iterations/${first.id}`, () => renameDrawer.getByRole("button", { name: "保存修改" }).click()));
    check(`${prefix} 展示名改变不修改稳定编号`, first.display_name === "首轮文件来源更名" && first.iteration_number === 1);
    await page.locator(`[data-iteration-id="${second.id}"]`).getByRole("button", { name: "编辑迭代" }).click();
    const goalDrawer = page.getByRole("dialog", { name: "编辑产品迭代" }); await goalDrawer.getByPlaceholder("这一轮最想改变什么？").fill("补充覆盖和只读权限验证目标");
    Object.assign(second, await mutation(`/api/iterations/${second.id}`, () => goalDrawer.getByRole("button", { name: "保存修改" }).click()));
    check(`${prefix} 暂不填写后的目标可补充且编号2不变`, second.goal === "补充覆盖和只读权限验证目标" && second.iteration_number === 2);
    await openIteration(first); const firstRoute = `${base}/projects/${projectId}/iterations/${first.id}`;
    async function conversationReady() { await conversation(); await eventually(() => page.getByLabel("输入消息").isEnabled(), Boolean, "会话可输入"); }
    const statePath = `/api/iterations/${first.id}/workbench`;
    const state = () => api(statePath);
    await page.getByRole("button", { name: "开始本阶段工作" }).waitFor();
    const initial = await state();
    check(`${prefix} 四环初始未开始且无会话`, initial.stages.length === 4 && initial.stages.every((item) => item.status === "not_started" && item.sessions.length === 0));
    const nav = page.getByRole("region", { name: "四环阶段导航" });
    for (const label of ["需求分析", "原型设计", "PRD", "任务拆分"]) check(`${prefix} ${label}一级导航可见`, await nav.getByRole("button", { name: new RegExp(label) }).isVisible());
    await nav.getByRole("button", { name: /PRD/ }).click();
    await page.getByRole("button", { name: "返回需求分析", exact: true }).click();
    check(`${prefix} 跳过前置环节的提示允许返回`, (await state()).currentStage === "analysis");
    for (const [label, key] of [["任务拆分", "tickets"], ["原型设计", "prototype"], ["PRD", "prd"]]) {
      await mutation(statePath, async () => {
        await nav.getByRole("button", { name: new RegExp(label) }).click();
        await page.getByRole("button", { name: `继续进入${label}`, exact: true }).click();
      });
      check(`${prefix} 可直接进入空${label}`, (await state()).currentStage === key && await page.getByRole("button", { name: "开始本阶段工作" }).isVisible());
    }
    await mutation(statePath, () => nav.getByRole("button", { name: /需求分析/ }).click());
    const afterNavigation = await state();
    const [emptyFiles] = await connection.execute("SELECT COUNT(*) AS total FROM project_files WHERE project_id = ?", [projectId]);
    requireOkay(`${prefix} 空阶段来回导航不建会话、不变状态、不写文件`, afterNavigation.stages.every((item) => item.sessions.length === 0 && item.status === "not_started") && Number(emptyFiles[0].total) === 0);
    await capture("empty-navigation");
    const sessionPath = `/api/iterations/${first.id}/stages/analysis/sessions`;
    const created = await mutation(sessionPath, () => page.getByRole("button", { name: "开始本阶段工作" }).click(), 201);
    const firstSession = created.session; session = firstSession; currentKey = "analysis";
    await page.locator(`[data-session-id="${firstSession.id}"][aria-current="page"]`).waitFor({ state: "attached" });
    await conversationReady();
    check(`${prefix} 显式创建会话进入进行中`, (await state()).stages.find((item) => item.key === "analysis").status === "in_progress");
    await mutation(`/api/iterations/${first.id}/stages/analysis/complete`, () => page.getByRole("button", { name: "完成本阶段", exact: true }).click());
    await page.getByRole("button", { name: "重新打开阶段" }).waitFor();
    requireOkay(`${prefix} 零写入也能完成阶段`, (await state()).stages.find((item) => item.key === "analysis").status === "completed" && (await api(`/api/projects/${projectId}/files`)).length === 0);
    await page.reload(); await conversation();
    await page.getByRole("button", { name: "重新打开阶段" }).waitFor();
    check(`${prefix} 刷新保持完成状态和输入锁定`, (await state()).stages.find((item) => item.key === "analysis").status === "completed" && await page.getByLabel("输入消息").isDisabled());
    await mutation(statePath, () => page.getByRole("button", { name: "重新打开阶段" }).click());
    await conversationReady();
    check(`${prefix} 显式重新打开恢复进行中`, (await state()).stages.find((item) => item.key === "analysis").status === "in_progress");

    const analysisSession = session; event("两迭代目标分支、稳定编号与四环状态");
    await files();
    check(`${prefix} 空树固定四个树枝`, (await page.locator(".project-tree-branch > summary > span:first-child").allTextContents()).join(",") === "需求分析,原型,PRD,任务拆分");
    await page.getByRole("tab", { name: /当前上下文/ }).click();
    check(`${prefix} 空上下文明确正文边界`, await page.getByText("当前上下文为空，Agent 看得到文件目录，但看不到文件正文。", { exact: true }).isVisible());
    const emptyResult = await send("初始空上下文", "生成需求分析");
    check(`${prefix} 空请求只包含项目迭代阶段与空目录`, emptyResult.system.includes(projectName) && emptyResult.system.includes(first.display_name) && emptyResult.system.includes("阶段：需求分析") && emptyResult.system.includes("（暂无项目文件）") && emptyResult.system.includes("（当前会话没有加载项目文件正文）"));
    requireOkay(`${prefix} 待确认候选不改变阶段进度也不阻止显式完成`, (await state()).stages.find((item) => item.key === "analysis").status === "in_progress" && await page.getByRole("button", { name: "完成本阶段", exact: true }).isEnabled());
    await mutation(`/api/iterations/${first.id}/stages/analysis/complete`, () => page.getByRole("button", { name: "完成本阶段", exact: true }).click());
    requireOkay(`${prefix} 有pending候选仍能完成且候选不丢失`, (await state()).stages.find((item) => item.key === "analysis").status === "completed" && (await api(`${sessionBase()}/messages`)).messages.at(-1).candidate.status === "pending");
    await mutation(statePath, () => page.getByRole("button", { name: "重新打开阶段", exact: true }).click()); await conversationReady();
    const analysis = await decide(emptyResult, `需求分析-专项${viewport.width}.md`);
    check(`${prefix} 首次创建首修订且无旧版`, Number((await facts(analysis)).version) === 1 && (await facts(analysis)).previous_content === null);
    // 在同一真实产出上验证多会话隔离，不注入业务 fixture。
    await mutation(`${sessionBase()}/context`, () => page.getByRole("button", { name: `加入当前上下文：${analysis.filename}`, exact: true }).click());
    await conversation(); const firstDraft = "主会话独立未发送草稿";
    const firstHistory = await api(`${sessionBase()}/messages`);
    await page.getByLabel("输入消息").fill(firstDraft);
    if (compact) await region().getByRole("button", { name: /阶段会话/ }).click();
    const secondSession = (await mutation(sessionPath, () => page.getByRole("button", { name: "新建会话", exact: true }).click(), 201)).session;
    session = secondSession; await page.locator(`[data-session-id="${secondSession.id}"][aria-current="page"]`).waitFor({ state: "attached" }); await conversationReady();
    requireOkay(`${prefix} 同阶段新会话消息草稿上下文均独立为空`, (await api(`${sessionBase()}/messages`)).messages.length === 0 && (await api(`${sessionBase()}/context`)).fileIds.length === 0 && await page.getByLabel("输入消息").inputValue() === "");
    const delayedPath = `${sessionBase()}/messages`; const secondMessage = `独立生成_${token}`;
    await page.route(`${base}${delayedPath}`, (route) => route.continue({ headers: { ...route.request().headers(), "x-pm-verify-stream-delay": "1" } }), { times: 1 });
    await page.getByLabel("输入消息").fill(secondMessage);
    const pendingGeneration = page.waitForResponse((response) => new URL(response.url()).pathname === delayedPath && response.request().method() === "POST");
    await page.getByRole("button", { name: "发送消息", exact: true }).click(); await page.getByRole("button", { name: "停止生成", exact: true }).waitFor();
    await eventually(state, (value) => value.stages.find((item) => item.key === "analysis").generatingSessionIds.includes(secondSession.id), "真实生成占用第二会话");
    const beforeBusy = await assets();
    for (const [path, method] of [[`/api/iterations/${first.id}/stages/analysis/complete`, "POST"], [`/api/iterations/${first.id}/sessions/${secondSession.id}`, "DELETE"], [`/api/iterations/${first.id}`, "DELETE"]]) {
      const refusal = await page.request.fetch(`${base}${path}`, { method });
      requireOkay(`${prefix} 真实生成阻止${path.split("/").at(-1)}且无资产变化`, refusal.status() === 409 && equal(beforeBusy, await assets()));
    }
    requireOkay(`${prefix} 生成中完成阶段按钮禁用且第一会话未被占用`, await page.getByRole("button", { name: "完成本阶段", exact: true }).isDisabled() && !(await state()).stages.find((item) => item.key === "analysis").generatingSessionIds.includes(firstSession.id));
    if (compact) await region().getByRole("button", { name: /阶段会话/ }).click();
    await page.getByRole("button", { name: `删除会话：${secondSession.title}`, exact: true }).click();
    const generatingDelete = page.getByRole("alertdialog", { name: "删除阶段会话？" });
    check(`${prefix} 生成中会话删除禁用并提供停止动作`, await generatingDelete.getByRole("button", { name: "确认删除会话", exact: true }).isDisabled());
    await capture("generating-delete-blocked");
    await generatingDelete.getByRole("button", { name: "查看会话并停止生成", exact: true }).click(); await conversation();
    await mutation(`/api/iterations/${first.id}/sessions/${secondSession.id}/stop`, () => page.getByRole("button", { name: "停止生成", exact: true }).click());
    requireOkay(`${prefix} 停止真实生成返回409且没有新增文件`, (await pendingGeneration).status() === 409 && equal(beforeBusy, await assets()));
    await conversationReady(); const secondDraft = "第二会话独立未发送草稿"; await page.getByLabel("输入消息").fill(secondDraft);
    async function selectSession(value) {
      if (compact) await region().getByRole("button", { name: /阶段会话/ }).click();
      await page.locator(`[data-session-id="${value.id}"]`).click(); await page.locator(`[data-session-id="${value.id}"][aria-current="page"]`).waitFor({ state: "attached" }); session = value; await conversationReady();
    }
    await selectSession(firstSession);
    check(`${prefix} 切回主会话保留独立草稿消息与引用`, await page.getByLabel("输入消息").inputValue() === firstDraft && equal(firstHistory, await api(`${sessionBase()}/messages`)) && (await api(`${sessionBase()}/context`)).fileIds.includes(analysis.id));
    await selectSession(secondSession);
    check(`${prefix} 切回第二会话保留独立草稿与失败状态`, await page.getByLabel("输入消息").inputValue() === secondDraft && (await api(`${sessionBase()}/messages`)).messages.some((item) => item.role === "assistant" && item.status === "failed") && (await api(`${sessionBase()}/context`)).fileIds.length === 0);
    await selectSession(firstSession); await page.getByLabel("输入消息").fill(""); await files(); await page.getByRole("tab", { name: /当前上下文/ }).click();
    await mutation(`${sessionBase()}/context`, () => page.getByRole("button", { name: `从当前上下文移除 ${analysis.filename}`, exact: true }).click());
    event("同阶段多会话消息、上下文、草稿独立与真实生成停止");
    await stage("prototype", "原型设计"); const prototypeSession = session;
    const beforeSnapshotFault = await assets();
    const snapshotFault = await send("HTML快照故障", "同时生成结构化原型 Markdown 和 HTML", 502, "x-pm-verify-snapshot-failure");
    requireOkay(`${prefix} HTML持久化故障无快照候选半成品且消息failed`, equal(beforeSnapshotFault, await assets()) && snapshotFault.message.status === "failed" && !snapshotFault.message.candidate);
    check(`${prefix} HTML失败提供正式重试生成动作`, await page.getByRole("button", { name: "重试生成", exact: true }).last().isEnabled());
    evidence.push({ viewport, type: "snapshot-rollback", before: beforeSnapshotFault, after: await assets() });
    await capture("snapshot-failure-retry");
    await conversation();
    const retryPrototype = await mutation(`${sessionBase()}/messages`, () => page.getByRole("button", { name: "重试生成", exact: true }).last().click());
    await conversationReady();
    const retryRequests = (await readFile(join(output, "provider-requests.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const prototypeRequest = retryRequests.at(-1); providerEvidence.push({ viewport, label: "原型失败同消息UI重试", request: prototypeRequest });
    const protoResult = { body: retryPrototype, message: retryPrototype.messages.at(-1), system: prototypeRequest.messages.filter((item) => item.role === "system").map((item) => item.content).join("\n") };
    requireOkay(`${prefix} 原型失败同消息UI重试完成且供应商参数仍为正式入参`, protoResult.message.status === "completed" && Boolean(prototypeRequest));
    event("HTML事务故障与同消息重试");
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

    await openIteration(second); await stage("analysis", "需求分析");
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

    {
    const taskSend = async (label) => (await send(label)).body;
    const owner = first; await openIteration(owner); const ownerSession = await tasks();
    const generated = await taskSend("首套放弃"); const abandoned = generated.messages.at(-1).taskCandidate;
    requireOkay(`${prefix} replay Agent 生成完整两个待确认 issue`, abandoned?.status === "pending" && (await api(candidatePath(abandoned.id))).entries.length === 2);
    const emptyAssets = await assets(); await mutation(candidatePath(abandoned.id), () => card().getByRole("button", { name: "放弃整套候选", exact: true }).click());
    requireOkay(`${prefix} 首套整体放弃不创建任何资产`, equal(emptyAssets, await assets()));
    const fresh = await taskSend("首套确认"); const initial = fresh.messages.at(-1).taskCandidate;
    const initialWritten = await commit(initial.id, "initial"); const folderId = initialWritten.folderId; const initialFiles = await current(folderId);
    requireOkay(`${prefix} 首套只含稳定01和02且均首修订`, initialFiles.length === 2 && initialFiles.map((file) => file.issue_number).join(",") === "1,2" && initialFiles.every((file) => Number(file.version) === 1));
    const newBody = issueBody(1, `正文秘密_${token}`); const suffix = `改名秘密_${token}`;
    const rejectedMixed = await mixed(initialFiles, newBody, suffix); const beforeDiscard = await assets();
    await mutation(candidatePath(rejectedMixed), () => card().getByRole("button", { name: "放弃整套候选", exact: true }).click());
    requireOkay(`${prefix} 混合候选整体放弃全部资产不变`, equal(beforeDiscard, await assets()));
    const pending = await mixed(initialFiles, newBody, suffix); const written = await commit(pending, "mixed"); const updated = await current(folderId);
    requireOkay(`${prefix} 整套提交无新旧混杂且更新身份稳定`, updated.length === 2 && updated.map((file) => file.issue_number).join(",") === "1,3" && updated[0].id === initialFiles[0].id && Number(updated[0].version) === 2 && updated[0].content === newBody && updated[1].id !== initialFiles[1].id && Number(updated[1].version) === 1);
    const durable = await assets(); const folder = durable.task_folders.find((item) => item.id === folderId); const backup = typeof folder.previous_snapshot === "string" ? JSON.parse(folder.previous_snapshot) : folder.previous_snapshot;
    requireOkay(`${prefix} 唯一旧集合精确匹配写入前身份编号正文路径及修订清单`, equal(backup, snapItems(initialFiles)));
    const group = durable.project_file_changes.filter((item) => item.task_change_group_id === written.groupId);
    check(`${prefix} 用户整套三类变更同组同来源`, group.length === 3 && group.every((item) => item.actor === "user" && item.iteration_id === owner.id && item.session_id === ownerSession.id) && group.map((item) => item.operation).sort().join(",") === "create,delete,overwrite");
    const restored = await restore(true); const returned = await current(folderId);
    requireOkay(`${prefix} 整套撤回恢复原身份正文文件名并移除新增`, returned.length === 2 && returned.every((file, index) => file.id === initialFiles[index].id && file.filename === initialFiles[index].filename && file.content === initialFiles[index].content) && restored.entries.some((item) => item.change === "removed") && restored.entries.some((item) => item.change === "restored"));
    check(`${prefix} 被改和被删项撤回生成新修订并消耗备份`, returned.map((file) => Number(file.version)).join(",") === "3,2" && (await assets()).task_folders.find((item) => item.id === folderId).previous_snapshot === null && await page.getByRole("button", { name: "撤回上次任务修改", exact: true }).isDisabled());
    await capture("restore-complete");

    // 编辑、改名和删除仍通过所属 UI，逐项整套撤回，保留最初集合供权限探测。
    for (const action of ["edit", "rename", "delete"]) {
      const before = await current(folderId); const file = before[0]; await preview(file);
      if (action === "edit") {
        await page.getByRole("button", { name: "编辑正文", exact: true }).click(); await page.getByLabel("Markdown 正文").fill(`${file.content}\n\n用户编辑_${token}`);
        await mutation(`/api/iterations/${owner.id}/files/${file.id}`, () => page.getByRole("button", { name: "保存修改", exact: true }).click());
      } else {
        await page.getByRole("tab", { name: "文件详情与来源", exact: true }).click(); await page.getByRole("button", { name: action === "rename" ? "改名" : "删除文件", exact: true }).click();
        if (action === "rename") { await page.getByLabel("新描述", { exact: true }).fill(`用户后缀_${token}`); await mutation(`/api/iterations/${owner.id}/files/${file.id}`, () => page.getByRole("button", { name: "确认改名", exact: true }).click()); }
        else await mutation(`/api/iterations/${owner.id}/files/${file.id}`, () => page.getByRole("button", { name: "确认删除", exact: true }).click());
      }
      await page.getByRole("button", { name: "关闭预览", exact: true }).click(); await restore(false, action === "delete" ? file : null);
      const identities = (rows) => rows.map((item) => [item.id, item.issue_number, item.filename, item.content]);
      check(`${prefix} 所属UI ${action}整套撤回恢复身份正文路径`, equal(identities(await current(folderId)), identities(before)));
    }
    const ownerFile = (await current(folderId))[0]; await download(ownerFile);
    await mutation(`${sessionBase()}/context`, () => page.getByRole("button", { name: `加入当前上下文：${ownerFile.filename}`, exact: true }).click());
    const loaded = await taskSend("所属手动加载");
    check(`${prefix} 所属手动加载纯正文到实际供应商`, providerEvidence.at(-1).request.messages.some((message) => message.role === "system" && message.content.includes(ownerFile.content)) && (await api(`${sessionBase()}/context`)).fileIds.includes(ownerFile.id) && loaded.messages.at(-1).taskCandidate?.status === "pending");
    const guardCandidate = loaded.messages.at(-1).taskCandidate;
    const other = second; await openIteration(other); const otherSession = await tasks(); await files();
    await preview(ownerFile);
    check(`${prefix} 其他迭代预览只读且无正文编辑`, await page.getByText("其他迭代任务 · 只读", { exact: true }).isVisible() && await page.getByRole("button", { name: "编辑正文", exact: true }).count() === 0);
    await page.getByRole("tab", { name: "文件详情与来源", exact: true }).click(); await page.getByText("其他迭代仅可查看、下载和加载", { exact: true }).waitFor();
    check(`${prefix} 其他迭代无改名删除或撤回按钮`, await page.getByRole("button", { name: "改名", exact: true }).count() === 0 && await page.getByRole("button", { name: "删除文件", exact: true }).count() === 0 && await page.getByRole("button", { name: "撤回上次任务修改", exact: true }).count() === 0);
    await capture("other-readonly"); await page.getByRole("button", { name: "关闭预览", exact: true }).click(); await download(ownerFile);
    await mutation(`${sessionBase()}/context`, () => page.getByRole("button", { name: `加入当前上下文：${ownerFile.filename}`, exact: true }).click()); await taskSend("其他迭代手动加载");
    check(`${prefix} 其他迭代手动加载同一纯正文到实际供应商`, providerEvidence.at(-1).request.messages.some((message) => message.role === "system" && message.content.includes(ownerFile.content)));

    // 所有拒绝都核对精确状态和 sentinel，不把任意非 200 当作权限通过。
    const sentinels = [token, projectName, ownerFile.filename, ownerFile.content, suffix, newBody, ownerFile.id, owner.id, ownerSession.id, folderId, analysis.id, prototype.id, html[0].id, htmlBody];
    async function deny(label, path, method, data, expected, actor = page, headers = {}) {
      const response = await actor.request.fetch(`${base}${path}`, { method, ...(data ? { data } : {}), headers }); const text = await response.text(); const strings = responseStrings(JSON.parse(text));
      permissions.push({ viewport, label, path, method, expected, actual: response.status(), leaked: sentinels.some((value) => strings.some((text) => text.includes(value))) });
      requireOkay(`${prefix} ${label} ${method} 精确拒绝${expected}且无秘密泄露`, response.status() === expected && !sentinels.some((value) => strings.some((text) => text.includes(value))));
    }
    const beforeGuards = await assets();
    const beforeCandidates = (await connection.query("SELECT * FROM iteration_task_set_candidates ORDER BY id"))[0];
    const beforeContexts = (await connection.query("SELECT * FROM iteration_session_context_files ORDER BY session_id, file_id"))[0];
    await deny("普通单文件3MiB限制", `/api/iterations/${owner.id}/files/${analysis.id}`, "POST", { projectId, action: "edit", content: "x".repeat(3 * 1024 * 1024 + 1) }, 413);
    await deny("任务单文件3MiB限制", `/api/iterations/${owner.id}/files/${ownerFile.id}`, "POST", { projectId, action: "edit", content: "x".repeat(3 * 1024 * 1024 + 1) }, 413);
    await deny("所属用户也不能修改系统序号", `/api/iterations/${owner.id}/files/${ownerFile.id}`, "PATCH", { projectId, action: "rename", filename: ownerFile.filename.replace("/01-", "/99-") }, 400);
    await deny("消耗旧集合后禁止重做", `/api/iterations/${owner.id}/task-folder`, "PATCH", { projectId, folderId, action: "restore" }, 409);
    for (const [action, method, extra, status] of [["edit", "POST", { content: newBody }, 403], ["rename", "PATCH", { filename: `issues/iteration-1/01-无权.md` }, 403], ["delete", "DELETE", {}, 403], ["restore", "POST", {}, 409]]) await deny(`跨迭代${action}`, `/api/iterations/${other.id}/files/${ownerFile.id}`, method, { projectId, action, ...extra }, status);
    await deny("跨迭代文件夹撤回", folderPath(), "PATCH", { projectId, folderId, action: "restore" }, 403);
    const wrongCandidate = `/api/iterations/${other.id}/sessions/${ownerSession.id}/task-candidates/${guardCandidate.id}`;
    for (const [method, data] of [["GET", null], ["POST", { action: "write", expectedFingerprint: "a".repeat(64) }], ["POST", { action: "discard" }]]) await deny("错迭代候选", wrongCandidate, method, data, 404);
    for (const method of ["GET", "POST"]) await deny("错迭代手动候选", `/api/iterations/${other.id}/sessions/${ownerSession.id}/task-candidates`, method, method === "POST" ? { content: marker(1, "任务", issueBody(1, token)) } : null, 404);
    for (const method of ["PATCH", "DELETE"]) await deny("旧文件入口不能绕过任务归属", `/api/projects/${projectId}/files/${ownerFile.id}`, method, method === "PATCH" ? { content: newBody } : null, 403, page, { "x-current-iteration-id": other.id });
    await deny("旧Agent文件入口", `/api/projects/${projectId}/files`, "POST", { filename: "issues/01-权限.md", content: issueBody(1, token), agent_type: "ticket_splitter", source_message_id: guardCandidate.id }, 409);
    await deny("旧ticket-set入口", `/api/projects/${projectId}/ticket-sets`, "POST", { mode: "replace" }, 409);
    requireOkay(`${prefix} 跨迭代全部拒绝后资产候选上下文逐字段不变`, equal(beforeGuards, await assets()) && equal(beforeCandidates, (await connection.query("SELECT * FROM iteration_task_set_candidates ORDER BY id"))[0]) && equal(beforeContexts, (await connection.query("SELECT * FROM iteration_session_context_files ORDER BY session_id, file_id"))[0]));

    const secondProject = await createProject(`另一项目_${token}`); const externalIteration = await createIteration("另一项目迭代", secondProject.id); const externalSession = await tasks();
    const outsiderContext = await browser.newContext({ viewport }); const outsider = await outsiderContext.newPage(); outsider.setDefaultTimeout(20000); outsider.setDefaultNavigationTimeout(60000); await register(outsider, `verify-outsider-${viewport.width}-${token}@test.local`);
    const stableAssets = await assets(); const stableCandidates = (await connection.query("SELECT * FROM iteration_task_set_candidates ORDER BY id"))[0]; const stableContexts = (await connection.query("SELECT * FROM iteration_session_context_files ORDER BY session_id, file_id"))[0];
    for (const [label, actor, pathProject, pathIteration, pathSession] of [["跨项目", page, secondProject.id, externalIteration.id, externalSession.id], ["跨用户", outsider, projectId, owner.id, ownerSession.id]]) {
      for (const suffixPath of ["", "/history", "/download"]) await deny(`${label}普通文件正文来源下载`, `/api/projects/${pathProject}/files/${analysis.id}${suffixPath}`, "GET", null, 404, actor);
      for (const mode of ["", "?mode=view", "?mode=download"]) await deny(`${label}HTML快照`, `/api/projects/${pathProject}/snapshots/${html[0].id}${mode}`, "GET", null, 404, actor);
      await deny(`${label}普通文件改写`, `/api/iterations/${pathIteration}/files/${analysis.id}`, "POST", { projectId: pathProject, action: "edit", content: "越权正文" }, 404, actor);
      if (label === "跨用户") for (const path of [`/api/iterations/${owner.id}`, `/api/projects/${projectId}`, `/api/iterations/${owner.id}/sessions/${ownerSession.id}`]) await deny("跨用户过程或项目删除", path, "DELETE", null, 404, actor);
      if (label === "跨用户") for (const path of [`/api/projects/${projectId}/task-folders`, `/api/projects/${projectId}/files`, `/api/iterations/${owner.id}/workbench`]) await deny(label, path, "GET", null, 404, actor);
      else for (const path of [`/api/projects/${pathProject}/task-folders`, `/api/projects/${pathProject}/files`, `/api/iterations/${pathIteration}/stages/tickets/sessions/${pathSession}/context`]) {
        const response = await actor.request.get(`${base}${path}`); const body = await response.text();
        check(`${prefix} 跨项目合法读取仅自己的空目录或上下文`, response.status() === 200 && !sentinels.some((value) => body.includes(value)) && !body.includes(folderId) && !body.includes(ownerFile.id));
      }
      for (const suffixPath of ["", "/history", "/download"]) await deny(`${label}任务文件`, `/api/projects/${pathProject}/files/${ownerFile.id}${suffixPath}`, "GET", null, 404, actor);
      for (const action of ["edit", "rename", "delete", "restore"]) await deny(`${label}任务修改${action}`, `/api/iterations/${pathIteration}/files/${ownerFile.id}`, action === "edit" || action === "restore" ? "POST" : action === "rename" ? "PATCH" : "DELETE", { projectId: pathProject, action, filename: "issues/iteration-1/01-越权.md", content: newBody }, action === "restore" && label === "跨用户" ? 409 : 404, actor);
      for (const method of ["GET", "POST", "DELETE"]) {
        // 同用户另一项目的空上下文可读；跨项目加载和移除外来文件必须拒绝。
        if (label === "跨项目" && method === "GET") continue;
        await deny(`${label}上下文`, `/api/iterations/${pathIteration}/stages/tickets/sessions/${pathSession}/context`, method, method === "GET" ? null : { fileId: ownerFile.id }, 404, actor);
        await deny(`${label}上下文会话入口`, `/api/iterations/${pathIteration}/sessions/${pathSession}/context`, method, method === "GET" ? null : { fileId: ownerFile.id }, 404, actor);
      }
      const candidateBase = `/api/iterations/${pathIteration}/sessions/${pathSession}/task-candidates`;
      for (const [method, data] of [["GET", null], ["POST", { action: "write", expectedFingerprint: "a".repeat(64) }], ["POST", { action: "discard" }]]) await deny(`${label}候选`, `${candidateBase}/${guardCandidate.id}`, method, data, 404, actor);
      if (label === "跨用户") for (const method of ["GET", "POST"]) await deny("跨用户手动候选", candidateBase, method, method === "POST" ? { content: marker(1, "秘密", issueBody(1, token)) } : null, 404, actor);
      await deny(`${label}文件夹撤回`, `/api/iterations/${pathIteration}/task-folder`, "PATCH", { projectId: pathProject, folderId, action: "restore" }, 404, actor);
      await deny(`${label}错项目文件夹创建`, `/api/iterations/${pathIteration}/task-folder`, "POST", { projectId: label === "跨项目" ? projectId : pathProject }, label === "跨项目" ? 409 : 404, actor);
    }
    // 错项目与错迭代组合不能借原项目的所有权读取或修改外来的会话。
    for (const [method, data] of [["GET", null], ["POST", { content: marker(1, "任务", issueBody(1, token)) }]]) await deny("跨项目错配手动候选", `/api/iterations/${externalIteration.id}/sessions/${ownerSession.id}/task-candidates`, method, data, 404);
    requireOkay(`${prefix} 跨项目跨用户拒绝后全部资产、候选和上下文不变`, equal(stableAssets, await assets()) && equal(stableCandidates, (await connection.query("SELECT * FROM iteration_task_set_candidates ORDER BY id"))[0]) && equal(stableContexts, (await connection.query("SELECT * FROM iteration_session_context_files ORDER BY session_id, file_id"))[0]));
    await outsiderContext.close();

    await openIteration(owner); await tasks(); const restoredBase = await current(folderId);
    const numberCandidate = await mixed(restoredBase, issueBody(1, `新轮_${token}`, "#03"), `再次更新_${token}`);
    const numberReview = await api(candidatePath(numberCandidate)); const allocated = numberReview.entries.find((entry) => entry.change === "create");
    requireOkay(`${prefix} 被删03不复用且依赖同步映射为04`, allocated.number === 4 && numberReview.entries.find((entry) => entry.number === 1).content.includes("**Blocked by:** #04"));
    await commit(numberCandidate); await restore();
    const ownerBeforeForeign = await current(folderId);
    await openIteration(other); await tasks(); await conversation(); await page.getByRole("button", { name: "手动提出整套任务", exact: true }).click(); await page.getByRole("button", { name: "新增 issue", exact: true }).click();
    await page.getByLabel("文件名描述", { exact: true }).fill("本轮独立任务"); await page.getByLabel("完整 Markdown 正文", { exact: true }).fill(ownerFile.content);
    const ownCandidate = await mutation(proposalPath(), () => page.getByRole("button", { name: "生成整套待确认候选", exact: true }).click(), 201); const otherWritten = await commit(ownCandidate.candidateId);
    check(`${prefix} 其他迭代可建立自己的集合而不能改变原所属文件夹`, otherWritten.folderId !== folderId && equal(ownerBeforeForeign, await current(folderId)) && (await api(`/api/projects/${projectId}/task-folders`)).length === 2);
    await deny("每迭代至多一个任务文件夹", folderPath(), "POST", { projectId }, 409);
    // 归档阶段验证快照保留及旧入口不会因全部迭代消失恢复修改权限。
    await openIteration(owner); await tasks(); const archiveFile = (await current(folderId))[0]; await preview(archiveFile);
    await page.getByRole("button", { name: "编辑正文", exact: true }).click(); await page.getByLabel("Markdown 正文").fill(`${archiveFile.content}\n\n归档前耐久变更_${token}`);
    await mutation(`/api/iterations/${owner.id}/files/${archiveFile.id}`, () => page.getByRole("button", { name: "保存修改", exact: true }).click());
    await page.getByRole("button", { name: "关闭预览", exact: true }).click();
    const beforeArchive = await assets();
    const archiveSnapshot = beforeArchive.task_folders.find((item) => item.id === folderId).previous_snapshot;
    requireOkay(`${prefix} 删除所属前确实存在非空唯一旧集合`, Array.isArray(archiveSnapshot) ? archiveSnapshot.length > 0 : JSON.parse(archiveSnapshot).length > 0);

    journey.taskArtifacts = { ownerIterationId: owner.id, otherIterationId: other.id, ownerSessionId: ownerSession.id, otherSessionId: otherSession.id, folderId, otherFolderId: otherWritten.folderId, guardCandidateId: guardCandidate.id, archiveSnapshot };
    event("任务整套创建、混合变更、撤回、单项修改、递增编号、权限与归属");
    }

    await openIteration(first);
    await stage("analysis", "需求分析");
    const deletionPending = await send("删除来源前保留未确认候选", "生成需求分析");
    requireOkay(`${prefix} 删除来源前确有pending普通候选`, deletionPending.message.candidate?.status === "pending");
    const lock = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
    await lock.beginTransaction();
    try {
      await lock.query("SELECT id FROM projects WHERE id = ? FOR UPDATE", [projectId]);
      await lock.query("SELECT id FROM product_iterations WHERE id = ? FOR UPDATE", [first.id]);
      await lock.query("SELECT id FROM iteration_sessions WHERE id = ? FOR UPDATE", [analysisSession.id]);
      const beforeLock = await assets(); const started = Date.now();
      const conflicts = await Promise.all([page.request.delete(`${base}/api/iterations/${first.id}/sessions/${analysisSession.id}`), page.request.delete(`${base}/api/iterations/${first.id}`)]);
      const elapsedMs = Date.now() - started;
      requireOkay(`${prefix} 真实写入持锁即刻阻止会话与迭代删除且资产原样`, elapsedMs < 2500 && conflicts.every((response) => response.status() === 409) && (await conflicts[1].json()).reason === "writing" && equal(beforeLock, await assets()));
      evidence.push({ viewport, type: "deletion-writing-lock", elapsedMs });
    } finally { await lock.rollback(); await lock.end(); }
    if (compact) await region().getByRole("button", { name: /阶段会话/ }).click();
    await page.getByRole("button", { name: `删除会话：${analysisSession.title}`, exact: true }).click();
    check(`${prefix} 来源会话删除前明确保留文件与来源`, (await page.getByRole("alertdialog").innerText()).includes("写入时的名称快照"));
    check(`${prefix} 来源会话删除确认明确未确认候选无法恢复`, (await page.getByRole("alertdialog").innerText()).includes("候选") && (await page.getByRole("alertdialog").innerText()).includes("未确认"));
    const sessionDeletePath = `/api/iterations/${first.id}/sessions/${analysisSession.id}`;
    const beforeSessionDelete = await assets();
    await page.route(`${base}${sessionDeletePath}`, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "删除未完成，请重试。" }) }), { times: 1 });
    await mutation(sessionDeletePath, () => page.getByRole("button", { name: "确认删除会话", exact: true }).click(), 500);
    requireOkay(`${prefix} 会话网络失败保留弹窗对象且无假成功`, await page.getByRole("alertdialog").isVisible() && equal(beforeSessionDelete, await assets()) && (await api(sessionDeletePath)).id === analysisSession.id);
    await capture("session-delete-failure-retry");
    await mutation(`/api/iterations/${first.id}/sessions/${analysisSession.id}`, () => page.getByRole("button", { name: "确认删除会话", exact: true }).click());
    for (const table of ["iteration_session_messages", "iteration_session_context_files", "iteration_file_candidates"]) requireOkay(`${prefix} 删除来源会话清空${table}且保留资产`, (await connection.execute(`SELECT * FROM ${table} WHERE session_id = ?`, [analysisSession.id]))[0].length === 0 && equal(beforeSessionDelete, await assets()));
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
    await stage("tickets", "任务拆分");
    const sourceTaskSession = session; const beforeTaskSourceDelete = await assets();
    if (compact) await region().getByRole("button", { name: /阶段会话/ }).click();
    await page.getByRole("button", { name: `删除会话：${sourceTaskSession.title}`, exact: true }).click();
    await mutation(`/api/iterations/${first.id}/sessions/${sourceTaskSession.id}`, () => page.getByRole("button", { name: "确认删除会话", exact: true }).click());
    requireOkay(`${prefix} 任务来源会话删除保留唯一旧集合并清空任务候选`, equal(beforeTaskSourceDelete, await assets()) && (await connection.execute("SELECT * FROM iteration_task_set_candidates WHERE session_id = ?", [sourceTaskSession.id]))[0].length === 0);
    event("普通与任务来源会话删除、pending清理与备份保留");
    await openProject();
    for (const value of [first, second]) {
      const row = page.locator(`[data-iteration-id="${value.id}"]`); await row.getByRole("button", { name: /更多功能/ }).click(); await row.getByRole("button", { name: "删除产品迭代", exact: true }).click();
      const beforeIterationDelete = await assets();
      const iterationDialog = page.getByRole("alertdialog", { name: "删除产品迭代？" });
      const iterationDeleteCopy = await iterationDialog.innerText();
      check(`${prefix} 迭代删除确认说明文件备份任务旧集合快照与不可恢复`, ["候选", "备份", "任务旧集合", "HTML 快照", "无法撤销"].every((text) => iterationDeleteCopy.includes(text)));
      if (value.id === first.id) {
        await page.route(`${base}/api/iterations/${value.id}`, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "删除未完成，请重试。" }) }), { times: 1 });
        await mutation(`/api/iterations/${value.id}`, () => page.getByRole("button", { name: "确认删除迭代", exact: true }).click(), 500);
        requireOkay(`${prefix} 迭代删除网络失败原弹窗原对象可重试且资产不变`, await iterationDialog.isVisible() && await row.count() === 1 && equal(beforeIterationDelete, await assets()));
        await capture("iteration-delete-failure-retry");
      }
      await mutation(`/api/iterations/${value.id}`, () => page.getByRole("button", { name: "确认删除迭代", exact: true }).click());
      await row.waitFor({ state: "detached" });
      requireOkay(`${prefix} 迭代${value.iteration_number}删除全部阶段过程且项目资产逐字段保留`, equal(beforeIterationDelete, await assets()) && (await connection.execute("SELECT id FROM iteration_sessions WHERE iteration_id = ?", [value.id]))[0].length === 0);
    }
    check(`${prefix} 删除所有来源迭代仍保留正文与完整来源时间线`, (await facts(analysis)).content === analysis.candidateContent && (await history(analysis)).changes.every((item) => item.iterationDeleted && item.iterationId === null) && (await history(analysis)).changes.length === 6 && (await history(prototype)).createdBy.iterationDeleted);
    const prototypeAfterIteration = await facts(prototype); const prototypeIterationHistory = await history(prototype);
    check(`${prefix} 来源迭代删除后仍保留原型正文、非空唯一备份与可撤回事实`, prototypeAfterIteration.content === prototypeEdited && prototypeAfterIteration.previous_content === prototype.candidateContent && Number(prototypeAfterIteration.version) === 2 && prototypeIterationHistory.canUndo && prototypeIterationHistory.createdBy.iterationDeleted && prototypeIterationHistory.createdBy.iterationName === first.display_name && prototypeIterationHistory.createdBy.sessionDeleted);
    await page.getByRole("tab", { name: /项目文件树/ }).click();
    check(`${prefix} 没有当前迭代仍展示固定四树枝及删除占位`, await page.locator(".project-tree-branch").count() === 4 && await page.getByText("已删除 · 查看来源记录", { exact: true }).count() >= 1);
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
    check(`${prefix} MySQL 最终耐久文件与历史 API 事实一致`, finalFiles.filter((item) => !item.filename.startsWith("issues/")).length === 2 && finalFiles.every((item) => plain(item.content)) && finalChanges.length === 6 && finalChanges.filter((item) => item.actor === "agent").length === 2 && finalChanges.filter((item) => item.content_revision !== null).map((item) => Number(item.content_revision)).sort((a, b) => a - b).join(",") === "1,2,3,4,5" && finalSessions.length === 0);
    event("删除迭代后来源占位与全资产只读下载");
    const snapshotPath = `/api/projects/${projectId}/snapshots/${html[0].id}`;
    const externalProject = await createProject(`级联对照项目_${token}`); const external = externalProject; const foreignIterationResponse = await probe(`/api/projects/${external.id}/iterations`, "POST", { displayName: "级联对照", goal: "不受其他项目删除影响" }); const foreignIteration = foreignIterationResponse.body;
    await openProject();
    const noIterationBefore = await assets();
    for (const [path, method, data] of [[`/api/projects/${projectId}/files/${analysis.id}`, "PATCH", { content: "非法" }], [`/api/projects/${projectId}/files/${analysis.id}`, "DELETE"], [`/api/projects/${projectId}/files`, "POST", { filename: "需求分析.md", content: "# 非法", agent_type: "requirement_analyst", source_message_id: randomUUID() }], [`/api/projects/${projectId}/ticket-sets`, "POST", { mode: "replace" }]]) requireOkay(`${prefix} 无迭代旧${method}入口守卫`, (await probe(path, method, data)).status === 409);
    const record = (await probe(`/api/projects/${projectId}/work-records`, "POST", { name: "旧接口守卫" })).body; const tab = (await probe(`/api/work-records/${record.id}/tabs`, "POST", { agent_type: "requirement_analyst" })).body.tab;
    requireOkay(`${prefix} 无迭代旧上下文及HTML创建入口守卫`, (await probe(`/api/tabs/${tab.id}/files`, "POST", { file_id: analysis.id })).status === 409 && (await probe(`/api/projects/${projectId}/snapshots`, "POST", { content: "<!doctype html><html><body>非法</body></html>", tab_id: tab.id })).status === 409 && equal(noIterationBefore, await assets()));
    // 旧会话仍可对话，成果入口已退役；从公开 chat 创建真实非空消息和操作记录。
    const legacyChat = await page.request.post(`${base}/api/tabs/${tab.id}/chat`, { data: { content: `旧会话级联探针_${token}`, expectedVersion: tab.version, requestId: randomUUID() } }); const legacyReply = await legacyChat.text();
    requireOkay(`${prefix} 旧工作记录真实replay消息和操作创建完成`, legacyChat.status() === 200 && legacyReply.includes('"type":"done"'));
    async function legacyState() {
      const state = { work_records: (await connection.query("SELECT * FROM work_records WHERE id = ?", [record.id]))[0], tabs: (await connection.query("SELECT * FROM tabs WHERE id = ?", [tab.id]))[0] };
      for (const table of ["messages", "agent_file_contexts", "message_file_writes", "tab_operations"]) state[table] = (await connection.query(`SELECT * FROM ${table} WHERE tab_id = ? ORDER BY ${table === "agent_file_contexts" ? "file_id" : "id"}`, [tab.id]))[0];
      return state;
    }
    const oldProcess = await legacyState(); requireOkay(`${prefix} 项目删除前旧工作记录标签消息操作都非空`, oldProcess.work_records.length === 1 && oldProcess.tabs.length === 1 && oldProcess.messages.length === 2 && oldProcess.tab_operations.length > 0);
    const next = await createIteration("第三迭代不能接管归档"); const nextSession = await stage("analysis", "需求分析"); const issue = (await assets()).project_files.find((item) => item.task_folder_id === journey.taskArtifacts.folderId); const guardBefore = await assets();
    requireOkay(`${prefix} 新迭代编号不复用且归档任务可加入上下文`, next.iteration_number === 3 && (await probe(`${root()}/stages/analysis/sessions/${nextSession.id}/context`, "POST", { fileId: issue.id })).status === 200);
    for (const [action, method, extra, expected] of [["edit", "POST", { content: "非法接管" }, 403], ["rename", "PATCH", { filename: issue.filename.replace(/\.md$/, "接管.md") }, 403], ["delete", "DELETE", {}, 403], ["restore", "POST", {}, 409]]) requireOkay(`${prefix} 新迭代不能${action}归档任务`, (await probe(`${root()}/files/${issue.id}`, method, { projectId, action, ...extra })).status === expected);
    requireOkay(`${prefix} 新迭代不能撤回归档整套且拒绝后资产原样`, (await probe(`${root()}/task-folder`, "PATCH", { projectId, folderId: journey.taskArtifacts.folderId, action: "restore" })).status === 403 && equal(guardBefore, await assets()));
    // Agent 整套提交合同固定按当前迭代找文件夹，不接受目标 folderId；成功只能创建自己的集合。
    await stage("tickets", "任务拆分"); const ownTasksResult = await send("新迭代独立集合"); const ownTasks = await commit(ownTasksResult.message.taskCandidate.id);
    const afterOwn = await assets(); requireOkay(`${prefix} 新迭代Agent只能写自己的集合且归档所有字段原样`, ownTasks.folderId !== journey.taskArtifacts.folderId && equal(guardBefore.task_folders, afterOwn.task_folders.filter((item) => item.id !== ownTasks.folderId)) && equal(guardBefore.project_files, afterOwn.project_files.filter((item) => item.task_folder_id !== ownTasks.folderId)) && equal(guardBefore.project_file_changes, afterOwn.project_file_changes.filter((item) => item.task_folder_id !== ownTasks.folderId)));
    await send("项目删除前新迭代待确认集合");
    // 项目级联在真实 DELETE 部分执行后注入故障，完整旧接口和新过程均须回滚。
    const cascadeBefore = await assets(); const cascadeProcess = await processState(); const cascadeLegacy = await legacyState(); const deleteFailure = await probe(`/api/projects/${projectId}`, "DELETE", undefined, { "x-pm-assistant-test-cascade-fail-after": "project-files" });
    requireOkay(`${prefix} 项目级联真实故障全部文件来源及新旧过程回滚可重试`, deleteFailure.status === 500 && deleteFailure.body.code === "CASCADE_DELETE_FAILED" && equal(cascadeBefore, await assets()) && equal(cascadeProcess, await processState()) && equal(cascadeLegacy, await legacyState()) && (await probe(`/api/projects/${projectId}`)).status === 200);
    evidence.push({ viewport, type: "project-cascade-rollback", before: cascadeBefore, after: await assets(), processBefore: cascadeProcess, processAfter: await processState(), legacyBefore: cascadeLegacy, legacyAfter: await legacyState() });
    const deleted = await probe(`/api/projects/${projectId}`, "DELETE"); requireOkay(`${prefix} 只有删除项目才清理全部项目资产来源和新旧过程`, deleted.status === 200 && (await probe(`/api/projects/${projectId}`)).status === 404 && Object.values(await assets()).every((rows) => rows.length === 0) && Object.values(await processState()).every((rows) => rows.length === 0) && Object.values(await legacyState()).every((rows) => rows.length === 0));
    requireOkay(`${prefix} 项目删除不会影响另一项目及迭代`, (await probe(`/api/projects/${external.id}`)).status === 200 && (await probe(`/api/iterations/${foreignIteration.id}`)).status === 200);
    journey.projectDeleted = true; event("第三迭代编号不复用与项目级联故障回滚再清理");
    check(`${prefix} 浏览器无运行时异常`, errors.length === 0);
    workflows.push({ viewport, projectId, iterationIds: [first.id, second.id], sessionIds: [analysisSession.id, prototypeSession.id, prdSession.id], fileIds: [analysis.id, prototype.id, prd.id], snapshotId: html[0].id, finalFileCount: finalFiles.length, expectedAnalysisRevision: 5, expectedPrototypeRevision: 2, preservedPrototypeBackup: Boolean(prototypeAfterIteration.previous_content) });
    journey.checkpoints = ["registration-login", "two-iteration-goals", "four-stage-navigation-status", "multi-session-isolation-stop", "manual-context-provider", "ordinary-create-overwrite-rollback", "html-markdown", "revisions-undo-rename-delete", "task-set-atomic-submit-undo-sequence", "permission-isolation", "session-iteration-delete-failures", "deleted-source-readonly", "project-cascade-rollback"];
    journey.completed = fail === journeyFailStart; event("来源删除、无当前迭代只读与最终事实");
    await context.close();
  }
} catch (error) {
  check(`专项回放中断：${error instanceof Error ? error.message : String(error)}`, false);
  if (page && output) await page.screenshot({ path: join(output, "release-failure.png"), animations: "disabled" }).catch(() => undefined);
} finally {
  if (browser) await browser.close(); if (connection) await connection.end();
  if (output) {
    await writeFile(join(output, "permission-matrix.json"), JSON.stringify(permissions, null, 2), "utf8");
    await writeFile(join(output, "failure-facts.json"), JSON.stringify(evidence, null, 2), "utf8");
    await writeFile(join(output, "geometry.json"), JSON.stringify(geometry, null, 2), "utf8");
    await writeFile(join(output, "provider-evidence.json"), JSON.stringify(providerEvidence, null, 2), "utf8");
    await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, aiMode: "replay", liveCalls: 0, workflows, journeys, screenshots, assertions, permissions, faultEvidence: evidence }, null, 2), "utf8");
  }
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
