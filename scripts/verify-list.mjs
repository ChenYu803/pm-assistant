// 列表渲染视觉验证：插入各种列表格式，检查 computed style + 截图。
// 用法：AI_MODE=replay npm run verify:mysql-list-rendering
import { chromium } from "playwright-core";
import { assertPlaywrightAvailable, assertReplayEnvironment, connectMysqlForVerification, insertTestMessage } from "./verify-mysql-fixtures.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = "http://localhost:3000";

try {
  assertReplayEnvironment();
  await assertPlaywrightAvailable(chromium, { channel: "msedge" });
} catch (error) {
  console.error(`❌ ${error.message}`);
  console.log("\n结果: 0 通过, 1 失败（未运行）");
  process.exit(1);
}
const connection = await connectMysqlForVerification();

const email = `list-${Date.now()}@test.local`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

await page.goto(`${BASE}/register`);
await page.fill("#email", email);
await page.fill('input[type="password"]', "verify-pass-1234");
await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
await page.locator('form button[type="submit"]').click();
await page.waitForURL((u) => u.pathname !== "/register", { timeout: 15000 });
await page.goto(`${BASE}/projects`);
await page.getByRole("button", { name: "新建项目" }).click();
await page.fill('input[placeholder="输入项目名称"]', "列表验证");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /列表验证/ }).click();
await page.waitForURL((u) => /\/projects\/[0-9a-f-]{36}$/.test(u.pathname));
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await page.getByRole("button", { name: "创建", exact: true }).click();
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((u) => u.pathname.startsWith("/workspace/"));
const workRecordId = page.url().split("/").pop();
await page.getByRole("button", { name: /需求分析/ }).first().click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(600);

const tabsRes = await page.evaluate(async (id) => {
  const res = await fetch(`/api/work-records/${id}/tabs`);
  return res.json();
}, workRecordId);
const tabId = tabsRes[0].id;

const now = new Date();
const msg = `以下是各种列表格式的测试：

## 无序列表
- 第一项
- 第二项
- **加粗项** 混合内容

## 有序列表
1. 第一步
2. 第二步
3. 第三步

## 嵌套列表
- 父项一
  - 子项 A
  - 子项 B
- 父项二

## 任务列表
- [ ] 待办一
- [x] 已完成

## 数字中文格式
1、方案一
2、方案二`;
await insertTestMessage(connection, {
  role: "assistant",
  content: msg,
  tabId,
  status: "completed",
  timestamp: new Date(now.getTime() + 1000),
});

await page.reload();
await page.waitForLoadState("networkidle");
await page.locator(".prose h2").first().waitFor({ timeout: 10000 });
await page.waitForTimeout(1200);

// 检查所有 li 的 computed style 和结构
const result = await page.evaluate(() => {
  const lis = [...document.querySelectorAll(".prose li")];
  return lis.map((li, i) => {
    const cs = getComputedStyle(li);
    const ul = li.closest("ul");
    const ol = li.closest("ol");
    return {
      idx: i,
      text: li.innerText.slice(0, 25),
      listStyleType: cs.listStyleType,
      marginLeft: cs.marginLeft,
      display: cs.display,
      inUl: !!ul,
      inOl: !!ol,
      ulListStyle: ul ? getComputedStyle(ul).listStyleType : null,
      ulHasClass: ul ? (ul.className || "") : "",
      liClass: (li.className || "").toString(),
    };
  });
});

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? `：${detail}` : ""}`);
  }
}

check("列表至少渲染一个列表项", result.length > 0, `实际=${result.length}`);
check("无序列表使用列表项语义", result.some((item) => item.inUl && item.display === "list-item"));
check("有序列表使用列表项语义", result.some((item) => item.inOl && item.display === "list-item"));
check("列表项保留可见样式", result.every((item) => item.listStyleType !== "none" && item.display === "list-item"));
check("嵌套列表结构存在", result.some((item) => item.text.includes("子项") && item.inUl));
console.log(JSON.stringify(result, null, 1));
await page.screenshot({
  path: path.join(ROOT, ".scratch", "screenshots", "verify", "04-list-render.png"),
});
await browser.close();
await connection.end();

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
