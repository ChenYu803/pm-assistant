// v1.41 #21：真实 UI 创建和修改任务，公开 API 权限探测，MySQL 仅观察耐久事实。
// 隔离副本仅记录 createAIStream 实际入参；不替换 prompt、replay 或建立数据库夹具。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.BASE_URL; const output = process.env.V141_REPLAY_OUTPUT_DIR;
let pass = 0; let fail = 0; let browser; let connection; let page;
const assertions = []; const workflows = []; const screenshots = []; const providerEvidence = []; const permissions = [];
function check(name, okay) {
  assertions.push({ name, okay: Boolean(okay) });
  if (okay) { pass++; console.log(`✅ ${name}`); } else { fail++; console.error(`❌ ${name}`); }
}
function requireOkay(name, okay) { check(name, okay); if (!okay) throw new Error(`关键事实不成立：${name}`); }
// MySQL JSON 可能重排对象键；比较全部字段值并保留数组顺序与时间戳。
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(JSON.parse(JSON.stringify(a)))) === JSON.stringify(canonical(JSON.parse(JSON.stringify(b))));
const plain = (text) => !/changelog|变更日志|%%%FILE_|%%%HTML_/i.test(text);
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
  await actor.locator('form button[type="submit"]').click();
  await actor.waitForURL((url) => url.pathname === "/projects");
}
const issueBody = (number, token, dependency = "None") => `# ${String(number).padStart(2, "0")} — 完整任务\n\n**What to build:** 用户可以完成任务与权限核对 ${token}\n\n**Blocked by:** ${dependency}\n\n## 验收标准\n- [ ] 用户确认后看到完整结果。`;
const marker = (number, suffix, content) => `%%%FILE_BEGIN%%% issues/${String(number).padStart(2, "0")}-${suffix}.md\n${content}\n%%%FILE_END%%%`;

try {
  if (!base || !output || process.env.AI_MODE !== "replay") throw new Error("必须通过隔离 replay 入口运行");
  await mkdir(output, { recursive: true });
  const mode = await fetch(`${base}/api/verify/replay-mode`);
  requireOkay("聊天前服务端确认 AI_MODE=replay", mode.ok && (await mode.json()).aiMode === "replay");
  connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
  const [empty] = await connection.query("SELECT COUNT(*) AS total FROM users");
  requireOkay("专项从零用户空库开始", Number(empty[0].total) === 0);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const prefix = `${viewport.width}×${viewport.height}`; const compact = viewport.width < 1100; const token = randomUUID();
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.addInitScript(() => {
      const insert = () => { if (!document.head || document.getElementById("verify-hide-next-indicator")) return; const style = document.createElement("style"); style.id = "verify-hide-next-indicator"; style.textContent = "nextjs-portal { display: none !important; }"; document.head.appendChild(style); };
      new MutationObserver(insert).observe(document, { childList: true, subtree: true }); insert();
    });
    page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(60000); const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await register(page, `verify-tasks-${viewport.width}-${token}@test.local`);
    async function createProject(name) {
      await page.goto(`${base}/projects`); await page.getByRole("button", { name: "新建一个项目", exact: true }).first().click();
      await page.getByRole("dialog", { name: "新建一个项目" }).getByRole("textbox").fill(name);
      return mutation("/api/projects", () => page.getByRole("button", { name: "创建项目", exact: true }).click(), 201);
    }
    const projectName = `任务权限秘密项目_${token}`; const project = await createProject(projectName); const projectId = project.id;
    let iteration; let session;
    const folderPath = () => `/api/iterations/${iteration.id}/task-folder`;
    const proposalPath = () => `/api/iterations/${iteration.id}/sessions/${session.id}/task-candidates`;
    const candidatePath = (id) => `${proposalPath()}/${id}`;
    const sessionBase = () => `/api/iterations/${iteration.id}/stages/tickets/sessions/${session.id}`;
    const conversation = async () => { if (compact) await page.getByRole("navigation", { name: "工作台区域" }).getByRole("button", { name: "对话", exact: true }).click(); };
    async function files() {
      if (compact) await page.getByRole("navigation", { name: "工作台区域" }).getByRole("button", { name: /文件与上下文/ }).click();
      else if (await page.getByRole("button", { name: "展开文件区" }).isVisible()) await page.getByRole("button", { name: "展开文件区" }).click();
      await page.getByRole("tab", { name: /项目文件树/ }).click();
    }
    async function capture(name) { check(`${prefix} ${name}无水平溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); const path = join(output, `tasks-${viewport.width}-${name}.png`); await page.screenshot({ path, animations: "disabled" }); if (!screenshots.includes(path)) screenshots.push(path); }
    async function createIteration(name, targetProject = projectId) {
      await page.goto(`${base}/projects/${targetProject}`); await page.getByRole("button", { name: "创建产品迭代", exact: true }).first().click();
      const drawer = page.getByRole("dialog", { name: "创建产品迭代", exact: true });
      await drawer.getByPlaceholder("例如：降低首次使用流失").fill(name); await drawer.getByText("填写本轮目标", { exact: true }).click();
      await drawer.getByPlaceholder("这一轮最想改变什么？").fill("用户确认完整任务集合，其他迭代只读");
      const value = await mutation(`/api/projects/${targetProject}/iterations`, () => drawer.getByRole("button", { name: "创建并进入工作区" }).click(), 201);
      await page.waitForURL(`${base}/projects/${targetProject}/iterations/${value.id}`); await page.getByRole("region", { name: "四环阶段导航" }).waitFor(); iteration = value; session = null; return value;
    }
    async function openIteration(value, targetProject = projectId) {
      await page.goto(`${base}/projects/${targetProject}/iterations/${value.id}`); await page.getByRole("region", { name: "四环阶段导航" }).waitFor(); iteration = value;
      const state = await api(`/api/iterations/${value.id}/workbench`); session = state.stages.find((item) => item.key === "tickets").sessions[0] ?? null;
    }
    async function tasks() {
      const state = await api(`/api/iterations/${iteration.id}/workbench`);
      if (state.currentStage !== "tickets") {
        await page.getByRole("region", { name: "四环阶段导航" }).getByRole("button", { name: /任务拆分/ }).click();
        const skip = page.getByRole("button", { name: "继续进入任务拆分", exact: true });
        await eventually(async () => ({ skip: await skip.isVisible(), state: await api(`/api/iterations/${iteration.id}/workbench`) }), (value) => value.skip || value.state.currentStage === "tickets", "任务阶段或提示");
        if (await skip.isVisible()) await skip.click();
        await eventually(() => api(`/api/iterations/${iteration.id}/workbench`), (value) => value.currentStage === "tickets", "任务阶段保存");
      }
      await conversation(); const latest = await api(`/api/iterations/${iteration.id}/workbench`); session = latest.stages.find((item) => item.key === "tickets").sessions[0] ?? null;
      if (!session) session = (await mutation(`/api/iterations/${iteration.id}/stages/tickets/sessions`, () => page.getByRole("button", { name: "开始本阶段工作" }).click(), 201)).session;
      await eventually(() => page.getByLabel("输入消息").isEnabled(), Boolean, "任务会话可输入"); return session;
    }
    async function assets() {
      const facts = {};
      for (const table of ["project_files", "task_folders", "project_file_changes"]) facts[table] = (await connection.execute(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY id`, [projectId]))[0];
      return facts;
    }
    const issues = async () => (await connection.execute("SELECT * FROM project_files WHERE project_id = ? ORDER BY issue_number", [projectId]))[0];
    const current = async (folderId) => (await issues()).filter((file) => file.task_folder_id === folderId);
    const snapItems = (rows) => rows.map((row) => ({ id: row.id, issue_number: Number(row.issue_number), filename: row.filename, content: row.content, version: Number(row.version) }));
    async function send(label) {
      await conversation(); const content = `确认并输出完整任务集合 专项探针_${token}_${label}`;
      await page.getByLabel("输入消息").fill(content); const body = await mutation(`${sessionBase()}/messages`, () => page.getByRole("button", { name: "发送消息", exact: true }).click());
      await eventually(() => page.getByLabel("输入消息").isEnabled(), Boolean, "回复完成");
      const records = (await readFile(join(output, "provider-requests.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const request = records.findLast((item) => item.messages?.filter((message) => message.role === "user").at(-1)?.content === content);
      requireOkay(`${prefix} ${label} 到达真实供应商入参边界`, Boolean(request)); providerEvidence.push({ viewport, label, request }); return body;
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
      // 撤回反馈先于目录刷新；等待公开树的删除占位变回正常文件，再执行下一步。
      await eventually(() => target.getAttribute("class"), (value) => value !== null && !value.split(/\s+/).includes("deleted"), "项目目录完成恢复对账");
      await target.click(); await page.getByRole("dialog", { name: `预览 ${file.filename}`, exact: true }).waitFor();
    }
    async function download(file) {
      await preview(file); const pending = page.waitForEvent("download"); await page.getByRole("link", { name: `下载 ${file.filename}`, exact: true }).click();
      const item = await pending; check(`${prefix} UI 查看下载是同一纯正文`, await readFile(await item.path(), "utf8") === file.content && plain(file.content));
      await page.getByRole("button", { name: "关闭预览", exact: true }).click();
    }

    const owner = await createIteration("所属任务迭代"); const ownerSession = await tasks();
    const generated = await send("首套放弃"); const abandoned = generated.messages.at(-1).taskCandidate;
    requireOkay(`${prefix} replay Agent 生成完整两个待确认 issue`, abandoned?.status === "pending" && (await api(candidatePath(abandoned.id))).entries.length === 2);
    const emptyAssets = await assets(); await mutation(candidatePath(abandoned.id), () => card().getByRole("button", { name: "放弃整套候选", exact: true }).click());
    requireOkay(`${prefix} 首套整体放弃不创建任何资产`, equal(emptyAssets, await assets()));
    const fresh = await send("首套确认"); const initial = fresh.messages.at(-1).taskCandidate;
    const initialWritten = await commit(initial.id, "initial"); const folderId = initialWritten.folderId; const first = await current(folderId);
    requireOkay(`${prefix} 首套只含稳定01和02且均首修订`, first.length === 2 && first.map((file) => file.issue_number).join(",") === "1,2" && first.every((file) => Number(file.version) === 1));
    const newBody = issueBody(1, `正文秘密_${token}`); const suffix = `改名秘密_${token}`;
    const rejectedMixed = await mixed(first, newBody, suffix); const beforeDiscard = await assets();
    await mutation(candidatePath(rejectedMixed), () => card().getByRole("button", { name: "放弃整套候选", exact: true }).click());
    requireOkay(`${prefix} 混合候选整体放弃全部资产不变`, equal(beforeDiscard, await assets()));
    const pending = await mixed(first, newBody, suffix); const written = await commit(pending, "mixed"); const updated = await current(folderId);
    requireOkay(`${prefix} 整套提交无新旧混杂且更新身份稳定`, updated.length === 2 && updated.map((file) => file.issue_number).join(",") === "1,3" && updated[0].id === first[0].id && Number(updated[0].version) === 2 && updated[0].content === newBody && updated[1].id !== first[1].id && Number(updated[1].version) === 1);
    const durable = await assets(); const folder = durable.task_folders.find((item) => item.id === folderId); const backup = typeof folder.previous_snapshot === "string" ? JSON.parse(folder.previous_snapshot) : folder.previous_snapshot;
    requireOkay(`${prefix} 唯一旧集合精确匹配写入前身份编号正文路径及修订清单`, equal(backup, snapItems(first)));
    const group = durable.project_file_changes.filter((item) => item.task_change_group_id === written.groupId);
    check(`${prefix} 用户整套三类变更同组同来源`, group.length === 3 && group.every((item) => item.actor === "user" && item.iteration_id === owner.id && item.session_id === ownerSession.id) && group.map((item) => item.operation).sort().join(",") === "create,delete,overwrite");
    const restored = await restore(true); const returned = await current(folderId);
    requireOkay(`${prefix} 整套撤回恢复原身份正文文件名并移除新增`, returned.length === 2 && returned.every((file, index) => file.id === first[index].id && file.filename === first[index].filename && file.content === first[index].content) && restored.entries.some((item) => item.change === "removed") && restored.entries.some((item) => item.change === "restored"));
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
    const loaded = await send("所属手动加载");
    check(`${prefix} 所属手动加载纯正文到实际供应商`, providerEvidence.at(-1).request.messages.some((message) => message.role === "system" && message.content.includes(ownerFile.content)) && (await api(`${sessionBase()}/context`)).fileIds.includes(ownerFile.id) && loaded.messages.at(-1).taskCandidate?.status === "pending");
    const guardCandidate = loaded.messages.at(-1).taskCandidate;
    const other = await createIteration("其他只读迭代"); const otherSession = await tasks(); await files();
    await preview(ownerFile);
    check(`${prefix} 其他迭代预览只读且无正文编辑`, await page.getByText("其他迭代任务 · 只读", { exact: true }).isVisible() && await page.getByRole("button", { name: "编辑正文", exact: true }).count() === 0);
    await page.getByRole("tab", { name: "文件详情与来源", exact: true }).click(); await page.getByText("其他迭代仅可查看、下载和加载", { exact: true }).waitFor();
    check(`${prefix} 其他迭代无改名删除或撤回按钮`, await page.getByRole("button", { name: "改名", exact: true }).count() === 0 && await page.getByRole("button", { name: "删除文件", exact: true }).count() === 0 && await page.getByRole("button", { name: "撤回上次任务修改", exact: true }).count() === 0);
    await capture("other-readonly"); await page.getByRole("button", { name: "关闭预览", exact: true }).click(); await download(ownerFile);
    await mutation(`${sessionBase()}/context`, () => page.getByRole("button", { name: `加入当前上下文：${ownerFile.filename}`, exact: true }).click()); await send("其他迭代手动加载");
    check(`${prefix} 其他迭代手动加载同一纯正文到实际供应商`, providerEvidence.at(-1).request.messages.some((message) => message.role === "system" && message.content.includes(ownerFile.content)));

    // 所有拒绝都核对精确状态和 sentinel，不把任意非 200 当作权限通过。
    const sentinels = [token, projectName, ownerFile.filename, ownerFile.content, suffix, newBody];
    async function deny(label, path, method, data, expected, actor = page, headers = {}) {
      const response = await actor.request.fetch(`${base}${path}`, { method, ...(data ? { data } : {}), headers }); const text = await response.text();
      permissions.push({ viewport, label, path, method, expected, actual: response.status(), leaked: sentinels.some((value) => text.includes(value)) });
      requireOkay(`${prefix} ${label} ${method} 精确拒绝${expected}且无秘密泄露`, response.status() === expected && !sentinels.some((value) => text.includes(value)));
    }
    const beforeGuards = await assets();
    const beforeCandidates = (await connection.query("SELECT * FROM iteration_task_set_candidates ORDER BY id"))[0];
    const beforeContexts = (await connection.query("SELECT * FROM iteration_session_context_files ORDER BY session_id, file_id"))[0];
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
    for (const value of [owner, other]) {
      const response = await page.request.delete(`${base}/api/iterations/${value.id}`); requireOkay(`${prefix} 公开删除迭代成功`, response.status() === 200);
    }
    requireOkay(`${prefix} 所属删除后资产正文、唯一快照和来源完整保留`, equal(beforeArchive, await assets()));
    const archives = await api(`/api/projects/${projectId}/task-folders`);
    check(`${prefix} 所属迭代删除后任务文件夹全部只读归档`, archives.every((item) => item.archived && item.ownerIterationId === null));
    for (const method of ["PATCH", "DELETE"]) await deny("全部迭代删除后的旧文件守卫", `/api/projects/${projectId}/files/${ownerFile.id}`, method, method === "PATCH" ? { content: newBody } : null, 409);
    await deny("全部迭代删除后的旧Agent入口", `/api/projects/${projectId}/files`, "POST", { filename: "issues/01-归档.md", content: issueBody(1, token), agent_type: "ticket_splitter", source_message_id: guardCandidate.id }, 409);
    await deny("全部迭代删除后的旧ticket-set入口", `/api/projects/${projectId}/ticket-sets`, "POST", { mode: "replace" }, 409);
    await page.goto(`${base}/projects`); await page.getByRole("button", { name: projectName, exact: true }).click();
    await page.getByRole("tab", { name: /项目文件树/ }).click(); await page.locator(".project-tree-folder").first().waitFor();
    await eventually(() => page.getByText("已删除迭代 · 只读归档", { exact: true }).count(), (count) => count === archives.length, "归档文件夹归属信息加载完成");
    check(`${prefix} 项目UI展示归档且无任务撤回入口`, await page.getByText("已删除迭代 · 只读归档", { exact: true }).count() === 2 && await page.getByRole("button", { name: "撤回上次任务修改", exact: true }).count() === 0);
    check(`${prefix} 浏览器无运行时错误和水平溢出`, errors.length === 0 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await capture("archived-readonly");
    workflows.push({ viewport, projectId, iterationIds: [owner.id, other.id], sessionIds: [ownerSession.id, otherSession.id], folderIds: [folderId, otherWritten.folderId], permissionChecks: permissions.filter((item) => item.viewport.width === viewport.width).length, finalFiles: (await issues()).length });
    await context.close();
  }
} catch (error) {
  check(`专项回放中断：${error instanceof Error ? error.message : String(error)}`, false);
  if (page && output) await page.screenshot({ path: join(output, "task-permission-failure.png"), animations: "disabled" }).catch(() => undefined);
} finally {
  if (browser) await browser.close(); if (connection) await connection.end();
  if (output) {
    await writeFile(join(output, "provider-evidence.json"), JSON.stringify(providerEvidence, null, 2), "utf8");
    await writeFile(join(output, "permission-matrix.json"), JSON.stringify(permissions, null, 2), "utf8");
    await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, aiMode: "replay", workflows, screenshots, assertions }, null, 2), "utf8");
  }
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
