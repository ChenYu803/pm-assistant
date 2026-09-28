// v1.41 #08：原型 HTML 快照的生成、失败回滚、重试、隔离预览与回看。
import { chromium } from "playwright-core";
import nextEnv from "@next/env";
import { mkdir } from "node:fs/promises";
import { closeMysqlPoolForTests, getMysqlPool } from "../src/lib/mysql.ts";
import { extractPrototypeHtml } from "../src/lib/iteration-prototype-snapshots.ts";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.AI_MODE !== "replay") { console.error("❌ 本验证要求 AI_MODE=replay"); process.exit(1); }
const base = process.env.BASE_URL || "http://localhost:3000";
let pass = 0;
let fail = 0;
function check(name, okay) {
  if (okay) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.error(`❌ ${name}`); }
}
const json = (body, headers = {}) => ({ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init);
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body, type: response.headers.get("content-type"), disposition: response.headers.get("content-disposition"), csp: response.headers.get("content-security-policy") };
  }, { path, init });
}

await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
try {
  check("不完整或空 HTML 标记不会被保存为快照", extractPrototypeHtml("%%%HTML_BEGIN%%%\n<html>未闭合").kind === "invalid" && extractPrototypeHtml("%%%HTML_BEGIN%%%\n%%%HTML_END%%%").kind === "invalid");
  const email = `verify-snapshot-${Date.now()}@test.local`;
  await page.goto(`${base}/register`);
  await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
  const project = await api(page, "/api/projects", json({ name: "原型快照验证" }));
  const projectId = project.body?.id;
  const iteration = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "原型快照迭代", goal: "验证 HTML 原型" }));
  const iterationId = iteration.body?.id;
  const analysisSession = await api(page, `/api/iterations/${iterationId}/stages/analysis/sessions`, { method: "POST" });
  const analysisSessionId = analysisSession.body?.session?.id;
  const analysisPath = `/api/iterations/${iterationId}/stages/analysis/sessions/${analysisSessionId}/messages`;
  const pendingAnalysis = await api(page, analysisPath, json({ content: "先给出一份待确认的需求分析" }));
  const pendingCandidateId = pendingAnalysis.body?.messages?.at(-1)?.candidate?.id;
  const session = await api(page, `/api/iterations/${iterationId}/stages/prototype/sessions`, { method: "POST" });
  const sessionId = session.body?.session?.id;
  check("已创建项目、迭代、未确认候选与原型会话", project.status === 201 && iteration.status === 201 && analysisSession.status === 201 && pendingCandidateId && session.status === 201);
  const messagesPath = `/api/iterations/${iterationId}/stages/prototype/sessions/${sessionId}/messages`;
  const snapshotsPath = `/api/projects/${projectId}/snapshots?iterationId=${iterationId}`;
  const snapshots = () => api(page, snapshotsPath);
  const first = await api(page, messagesPath, json({ content: "请给出第一个可视化原型" }));
  const firstList = await snapshots();
  const firstSnapshot = firstList.body?.[0];
  if (!firstSnapshot) throw new Error(`首条快照未生成：status=${first.status} body=${JSON.stringify(first.body).slice(0, 500)} list=${JSON.stringify(firstList.body)}`);
  check("成功回复原子生成一份 HTML 快照", first.status === 200 && firstSnapshot?.messageId === first.body?.assistantMessage?.id && firstList.body.length === 1);
  check("聊天只显示方案文字，不展示 HTML 源码", first.body?.messages?.at(-1)?.displayContent?.includes("这个方向") && !first.body.messages.at(-1).displayContent.includes("<html"));
  const detail = await api(page, `/api/projects/${projectId}/snapshots/${firstSnapshot.id}`);
  const view = await api(page, `/api/projects/${projectId}/snapshots/${firstSnapshot.id}?mode=view`);
  const download = await api(page, `/api/projects/${projectId}/snapshots/${firstSnapshot.id}?mode=download`);
  check("快照详情与再次打开返回同一 HTML", detail.status === 200 && view.status === 200 && view.body === detail.body.content);
  check("下载返回 HTML 附件", download.status === 200 && download.body === detail.body.content && download.disposition?.includes("attachment"));
  check("在线预览具备隔离响应策略", view.type?.startsWith("text/html") && view.csp?.includes("sandbox allow-scripts") && !view.csp?.includes("allow-same-origin"));
  const failed = await api(page, messagesPath, json({ content: "请修订原型" }, { "x-pm-verify-snapshot-failure": "1" }));
  const afterFailure = await snapshots();
  const failedHistory = await api(page, messagesPath);
  const analysisAfterFailure = await api(page, analysisPath);
  const failedMessage = failedHistory.body?.messages?.at(-1);
  check("落库故障明确失败且原快照未改变", failed.status === 502 && failed.body?.error?.includes("快照写入失败") && afterFailure.body?.length === 1 && afterFailure.body[0].id === firstSnapshot.id);
  check("故障回滚保留其他会话的未确认候选", analysisAfterFailure.body?.messages?.at(-1)?.candidate?.id === pendingCandidateId && analysisAfterFailure.body?.messages?.at(-1)?.candidate?.status === "pending");
  check("失败回复可重试", failedMessage?.status === "failed" && failedMessage?.errorMessage?.includes("快照写入失败"));
  await page.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
  await page.locator(".workbench-grid").waitFor();
  await page.getByRole("button", { name: "重试生成" }).waitFor();
  check("正式界面显示失败并提供重试操作", (await page.locator(".workbench-message").last().innerText()).includes("快照写入失败"));
  await page.getByRole("button", { name: "重试生成" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".snapshot-list button").length === 2);
  const afterRetry = await snapshots();
  check("重试成功保存第二版并保留第一版", afterRetry.body?.length === 2 && afterRetry.body[1].id === firstSnapshot.id && afterRetry.body[0].version === firstSnapshot.version + 1);
  const [files] = await getMysqlPool().query("SELECT COUNT(*) AS count FROM project_files WHERE project_id = ?", [projectId]);
  const workbench = await api(page, `/api/iterations/${iterationId}/workbench`);
  check("快照未写入 Markdown 文件或完成阶段", Number(files[0].count) === 0 && workbench.body.stages.find((item) => item.key === "prototype")?.status === "in_progress");

  await page.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
  await page.locator(".workbench-grid").waitFor();
  await page.getByRole("button", { name: /原型设计/ }).first().click();
  await page.getByRole("tab", { name: "HTML 快照" }).click();
  const firstViewUrl = `**/api/projects/${projectId}/snapshots/${firstSnapshot.id}?mode=view`;
  await page.route(firstViewUrl, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "预览暂时不可用" }) }));
  await page.getByRole("button", { name: /HTML 快照 · 第 1 版/ }).click();
  await page.getByRole("alert").getByText("预览暂时不可用").waitFor();
  check("快照预览请求失败时明确显示错误", await page.locator(".snapshot-detail iframe").count() === 0);
  await page.unroute(firstViewUrl);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.locator('.snapshot-detail iframe').waitFor();
  check("重试重新读取选中快照并恢复预览", await page.locator(".snapshot-error").count() === 0 && (await page.locator(".snapshot-detail").textContent()).includes("第 1 版"));
  check("正式界面可选择并预览旧快照", await page.locator('.snapshot-detail iframe').getAttribute("sandbox") === "allow-scripts" && (await page.locator(".snapshot-detail").textContent()).includes("第 1 版"));
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载 HTML" }).click();
  const browserDownload = await downloadEvent;
  check("正式界面能下载选中的旧快照", browserDownload.suggestedFilename() === `prototype-${firstSnapshot.version}.html`);
  if (process.env.CAPTURE_PROTOTYPE_SNAPSHOT === "1") {
    await mkdir(".impeccable/review", { recursive: true });
    await page.screenshot({ path: ".impeccable/review/prototype-snapshot-desktop.png", animations: "disabled", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".workbench-context").scrollIntoViewIfNeeded();
    check("390px 快照面板无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: ".impeccable/review/prototype-snapshot-mobile.png", animations: "disabled", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await page.reload();
  await page.locator(".workbench-grid").waitFor();
  await page.getByRole("tab", { name: "HTML 快照" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".snapshot-list button").length === 2);
  check("刷新后仍能再次打开两版快照", await page.locator(".snapshot-list button").count() === 2);
  check("HTML 快照未进入项目树或上下文", await page.locator(".project-tree-name").count() === 0 && (await api(page, `/api/iterations/${iterationId}/stages/prototype/sessions/${sessionId}/context`)).body?.files?.length === 0);
} finally {
  await context.close();
  await browser.close();
  await closeMysqlPoolForTests();
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
