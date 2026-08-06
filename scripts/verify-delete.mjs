// 验证文件删除功能：确认弹窗 → 取消保留 → 确认删除 → 文件树/DB/上下文引用清理
import { chromium } from "playwright-core";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = "http://localhost:3000";

const envRaw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
await mongoose.connect(env.MONGODB_URI);
const ProjectFile = mongoose.model(
  "VFile",
  new mongoose.Schema({
    filename: String,
    content: String,
    project_id: mongoose.Schema.Types.ObjectId,
    created_at: Date,
    updated_at: Date,
  }),
  "project_files"
);
const FileCtx = mongoose.model(
  "VCtx",
  new mongoose.Schema({
    tab_id: mongoose.Schema.Types.ObjectId,
    file_id: mongoose.Schema.Types.ObjectId,
  }),
  "agent_file_contexts"
);

const email = `del-${Date.now()}@test.local`;
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
  }
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

// ── 注册 → 项目 → 工作记录 → tab ──────────────────────────────
await page.goto(`${BASE}/register`);
await page.fill("#email", email);
await page.fill('input[type="password"]', "verify-pass-1234");
await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
await page.locator('form button[type="submit"]').click();
await page.waitForURL((u) => u.pathname !== "/register", { timeout: 15000 });
await page.goto(`${BASE}/projects`);
await page.getByRole("button", { name: "新建项目" }).click();
await page.fill('input[placeholder="输入项目名称"]', "删除验证");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /删除验证/ }).click();
await page.waitForURL((u) => /\/projects\/[0-9a-f]{24}$/.test(u.pathname));
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await page.getByRole("button", { name: "确认创建" }).click();
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((u) => u.pathname.startsWith("/workspace/"));
const workRecordId = page.url().split("/").pop();
await page.getByRole("button", { name: /需求分析/ }).first().click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(600);

const tabs = await page.evaluate(async (id) => {
  const r = await fetch(`/api/work-records/${id}/tabs`);
  return r.json();
}, workRecordId);
const tabId = tabs[0].id;
const wr = await page.evaluate(async (id) => {
  const r = await fetch(`/api/work-records/${id}`);
  return r.json();
}, workRecordId);
const projectId = wr.project_id;

// 造数据：项目文件 + 上下文引用
const now = new Date();
const fileDoc = await ProjectFile.create({
  filename: "需求分析.md",
  content: "# 需求分析文档\n\n测试内容",
  project_id: new mongoose.Types.ObjectId(projectId),
  created_at: now,
  updated_at: now,
});
await FileCtx.create({
  tab_id: new mongoose.Types.ObjectId(tabId),
  file_id: fileDoc._id,
});
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByText("需求分析.md").first().waitFor({ timeout: 10000 });

// ── 删除按钮出现（hover 显示）──
await page.locator("li", { hasText: "需求分析.md" }).first().hover();
const delBtn = page.getByTitle("删除");
await delBtn.waitFor({ state: "visible", timeout: 5000 });
check("删除按钮 hover 显示", await delBtn.isVisible());

// ── 点删除 → 确认弹窗 ──
await delBtn.click();
await page.locator('[role="alertdialog"]').waitFor({ state: "visible", timeout: 5000 });
const dlgText = await page.locator('[role="alertdialog"]').innerText();
check("确认弹窗出现且含文件名", dlgText.includes("需求分析.md"));
check("弹窗提示不可恢复", dlgText.includes("不可恢复"));
check("弹窗提示上下文清理", dlgText.includes("上下文"));

// ── 取消 → 文件保留 ──
await page.getByRole("button", { name: "取消" }).click();
await page.waitForTimeout(400);
const stillThere = await page.getByText("需求分析.md").first().isVisible();
check("取消后文件保留", stillThere);
const dbStill = await ProjectFile.findById(fileDoc._id).lean();
check("取消后 DB 中文件仍在", !!dbStill);

// ── 确认删除 → 文件消失 + DB/引用清理 ──
await page.locator("li", { hasText: "需求分析.md" }).first().hover();
await page.getByTitle("删除").click();
await page.getByRole("button", { name: "删除", exact: true }).click();
await page.waitForTimeout(800);
const gone = (await page.getByText("需求分析.md").count()) === 0;
check("确认后文件从文件树消失", gone);
const dbGone = !(await ProjectFile.findById(fileDoc._id).lean());
check("确认后 DB 中文件已删除", dbGone);
const ctxGone = (await FileCtx.countDocuments({ file_id: fileDoc._id })) === 0;
check("上下文引用已清理", ctxGone);
const emptyState = await page.getByText("暂无文件").isVisible();
check("文件树回到空态", emptyState);

await browser.close();
await mongoose.disconnect();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
