// v1.1 票 01 迁移后回放审计：文件更新、工作记录命名与空状态引导。
// 本文件由 verify-v11-ux.mjs 调用，不作为日常独立入口。
import { chromium } from "playwright-core";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` ${detail}` : ""}`);
  }
};

async function readProjectFile(page, projectId, filename) {
  const files = await page.evaluate(
    async (id) => (await fetch(`/api/projects/${id}/files`)).json(),
    projectId
  );
  const file = files.find((item) => item.filename === filename);
  if (!file) return null;
  return page.evaluate(
    async ({ id, fileId }) =>
      (await fetch(`/api/projects/${id}/files/${fileId}`)).json(),
    { id: projectId, fileId: file.id }
  );
}

async function waitForProjectFile(page, projectId, filename) {
  await page.waitForFunction(
    async ({ id, name }) => {
      const files = await fetch(`/api/projects/${id}/files`).then((res) =>
        res.json()
      );
      return files.some((file) => file.filename === name);
    },
    { id: projectId, name: filename }
  );
  return readProjectFile(page, projectId, filename);
}

async function writeProjectFile(page, projectId, file) {
  return page.evaluate(
    async ({ id, payload }) => {
      const response = await fetch(`/api/projects/${id}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { ok: response.ok, data: await response.json() };
    },
    { id: projectId, payload: file }
  );
}

async function createTab(page, workRecordId, agentType) {
  return page.evaluate(
    async ({ id, type }) => {
      const response = await fetch(`/api/work-records/${id}/tabs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_type: type }),
      });
      return { ok: response.ok, data: await response.json() };
    },
    { id: workRecordId, type: agentType }
  );
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15_000);

try {
  const email = `verify-v11-ticket01-${Date.now()}@test.local`;
  const password = "verify-pass-1234";

  // 注册 -> 项目 -> 工作记录列表。
  await page.goto(`${BASE}/register`);
  await page.fill("#email", email);
  await page.fill('input[type="password"]', password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/register");
  if (page.url().includes("/login")) {
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.includes("/login"));
  }

  await page.goto(`${BASE}/projects`);
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.fill('input[placeholder="输入项目名称"]', "v1.1 综合回放审计");
  await page.locator('form button[type="submit"]').click();
  await page.getByRole("link", { name: /v1.1 综合回放审计/ }).click();
  await page.waitForURL((url) => /\/projects\/[0-9a-f]{24}$/.test(url.pathname));

  // 创建面板：输入名称后 Enter 即创建，且不再显示旧的确认步骤。
  await page.getByRole("button", { name: "新建工作记录" }).first().click();
  await page.fill('input[placeholder="工作记录名称（可选）"]', "自定义工作记录");
  await page.locator('input[placeholder="工作记录名称（可选）"]').press("Enter");
  await page.getByRole("link", { name: "自定义工作记录", exact: true }).waitFor();
  check("票01：输入名称后回车直接创建", true);
  check(
    "票01：创建流程无确认创建中间步骤",
    (await page.getByRole("button", { name: "确认创建", exact: true }).count()) === 0
  );

  // 留空时仍保留未命名兜底。
  await page.getByRole("button", { name: "新建工作记录" }).first().click();
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("link", { name: "未命名", exact: true }).waitFor();
  check(
    "票01：留空创建显示未命名",
    (await page.getByRole("link", { name: "未命名", exact: true }).count()) === 1
  );

  // 工作记录列表的行内改名。
  const recordRow = page.locator("li").filter({ hasText: "自定义工作记录" });
  await recordRow.getByRole("button", { name: "改名", exact: true }).click();
  // 改名后名称文字会替换为 input，不能再依赖旧名称作为 locator 的过滤条件。
  const listRenameInput = page.locator("ul li input");
  await listRenameInput.fill("列表改名后的记录");
  await listRenameInput.press("Enter");
  await page.getByRole("link", { name: "列表改名后的记录", exact: true }).waitFor();
  check("票01：列表页行内改名生效", true);

  // 工作台顶栏改名。
  await page.getByRole("link", { name: "列表改名后的记录", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/workspace/"));
  const workRecordId = page.url().split("/").pop();
  const workRecord = await page.evaluate(
    async (id) => (await fetch(`/api/work-records/${id}`)).json(),
    workRecordId
  );
  const projectId = workRecord.project_id;

  await page.getByTitle("点击改名").click();
  const workspaceRenameInput = page.locator("nav input");
  await workspaceRenameInput.fill("工作台改名后的记录");
  await workspaceRenameInput.press("Enter");
  await page.getByTitle("点击改名").filter({ hasText: "工作台改名后的记录" }).waitFor();
  check("票01：工作台顶栏点击改名生效", true);

  // 空状态完整呈现四步流水线，且后续步骤只给出轻提示。
  const emptyStateText = await page.locator("main").innerText();
  check(
    "票01：空工作记录显示四步流水线",
    ["需求分析", "原型", "PRD 撰写", "任务拆分"].every((label) =>
      emptyStateText.includes(label)
    )
  );
  await page.getByRole("button", { name: /^原型/ }).click();
  await page.getByText("「原型」完成前置步骤后开启", { exact: true }).waitFor();
  check("票01：锁定步骤点击给出轻提示", true);

  // 只有需求分析可创建首个标签；创建后 + 恢复完整 Agent 选择。
  await page.getByRole("button", { name: /需求分析/ }).click();
  await page.locator("textarea").waitFor();
  check("票01：需求分析可创建首个标签页", true);
  await page.getByTitle("新建标签页").click();
  const agentDialog = page.getByRole("dialog");
  const dialogText = await agentDialog.innerText();
  check(
    "票01：已有标签页后可自由选择任意 Agent",
    ["需求分析", "原型", "MVP-PRD", "任务拆分"].every((label) =>
      dialogText.includes(label)
    )
  );
  await page.keyboard.press("Escape");

  const textarea = page.locator("textarea");
  const fileDialog = page.getByRole("dialog");

  // 首次回放：工作文档静默写入，正式文件进入确认流。
  await textarea.fill("请输出第一版需求分析");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await fileDialog.getByText("Agent 产出文件", { exact: true }).waitFor();
  const workingDoc = await waitForProjectFile(
    page,
    projectId,
    "需求分析-工作文档（回放）.md"
  );
  check("票01：工作文档仍静默写入", Boolean(workingDoc));
  check(
    "票01：首次正式文件出现写入确认",
    (await fileDialog.getByRole("checkbox", { name: "选择 需求分析.md" }).count()) === 1
  );
  await fileDialog.getByRole("button", { name: /批量写入/ }).click();
  await fileDialog.waitFor({ state: "hidden" });
  const firstRequirement = await waitForProjectFile(page, projectId, "需求分析.md");
  check("票01：确认后正式文件写入项目", Boolean(firstRequirement));

  // 再次输出同名文件必须重新确认；需求分析按既有 append 语义更新。
  await textarea.fill("请基于现有内容再次更新需求分析");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await fileDialog.getByText("Agent 产出文件", { exact: true }).waitFor();
  const beforeUpdate = firstRequirement?.content ?? "";
  await fileDialog.getByRole("button", { name: /批量写入/ }).click();
  await fileDialog.waitFor({ state: "hidden" });
  const secondRequirement = await readProjectFile(page, projectId, "需求分析.md");
  check(
    "票01：同名文件重新确认后按追加语义更新",
    Boolean(secondRequirement) && secondRequirement.content.length > beforeUpdate.length
  );

  // 原型和 PRD 也必须从 Agent 二次输出走进确认弹窗，再按覆盖语义更新。
  for (const { filename, agentType, prompt } of [
    { filename: "原型.md", agentType: "prototype", prompt: "确认写入原型" },
    { filename: "prd.md", agentType: "mvp_prd", prompt: "确认，继续详细撰写 PRD" },
  ]) {
    await writeProjectFile(page, projectId, {
      filename,
      content: `# ${filename}\n初始版内容`,
      agent_type: agentType,
    });
    const tab = await createTab(page, workRecordId, agentType);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByText(tab.data.tab.display_name, { exact: true }).click();
    await textarea.fill(prompt);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await fileDialog.getByText("Agent 产出文件", { exact: true }).waitFor();
    const confirmationShown =
      (await fileDialog.getByRole("checkbox", { name: `选择 ${filename}` }).count()) === 1;
    await fileDialog.getByRole("button", { name: /批量写入/ }).click();
    await fileDialog.waitFor({ state: "hidden" });
    const detail = await readProjectFile(page, projectId, filename);
    check(
      `票01：${filename} 二次输出确认后按覆盖语义更新`,
      tab.ok &&
        confirmationShown &&
        detail?.content.includes(filename === "原型.md" ? "商品浏览页" : "在线点餐") &&
        !detail.content.includes("初始版内容")
    );
  }

  // 拒绝新一轮写入后文件保持不变；刷新后历史消息也不应重复弹窗。
  await textarea.fill("这轮不要写入文件");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await fileDialog.getByText("Agent 产出文件", { exact: true }).waitFor();
  await fileDialog.getByRole("button", { name: "全部丢弃", exact: true }).click();
  await fileDialog.waitFor({ state: "hidden" });
  const afterDiscard = await readProjectFile(page, projectId, "需求分析.md");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  check(
    "票01：拒绝不落盘且刷新历史不重复确认",
    afterDiscard?.content === secondRequirement?.content &&
      (await page.getByRole("dialog").count()) === 0
  );

  // 三次对话后，手动改名仍保持用户给定名称（回放模式不调用真实命名模型）。
  const renamedRecord = await page.evaluate(
    async (id) => (await fetch(`/api/work-records/${id}`)).json(),
    workRecordId
  );
  check("票01：手动命名不会被自动命名覆盖", renamedRecord.name === "工作台改名后的记录");
} finally {
  await browser.close();
}

console.log(`\n票01迁移审计结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
