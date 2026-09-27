// 个人主页账号流程回放：只访问应用和 MySQL，不调用模型。
import { chromium } from "playwright-core";
import nextEnv from "@next/env";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.BASE_URL || "http://localhost:3000";
const email = `verify-profile-${Date.now()}@test.local`;
const originalPassword = "verify-pass-1234";
const nextPassword = "verify-next-1234";
let pass = 0;
let fail = 0;

function check(name, condition) {
  if (condition) {
    pass += 1;
    console.log(`✅ ${name}`);
  } else {
    fail += 1;
    console.error(`❌ ${name}`);
  }
}

async function post(page, pathname, body, method = "POST") {
  return page.evaluate(async ({ pathname, body, method }) => {
    const response = await fetch(pathname, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }, { pathname, body, method });
}

if (process.env.AI_MODE !== "replay") {
  console.error("❌ 账号回放要求 AI_MODE=replay");
  process.exit(1);
}

await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);

try {
  await page.goto(base);
  await page.getByRole("link", { name: "注册 / 登录" }).first().waitFor();
  check("游客首页显示注册登录", await page.getByRole("link", { name: "注册 / 登录" }).count() > 0);
  const guest = await post(page, "/api/profile", { nickname: "越权昵称" }, "PATCH");
  check("游客不能修改昵称", guest.status === 401);

  await page.goto(`${base}/register`);
  await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill(originalPassword);
  await page.locator('input[type="password"]').nth(1).fill(originalPassword);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");

  await page.goto(base);
  await page.getByRole("link", { name: "个人主页" }).first().waitFor();
  check("已登录首页切换为个人主页", await page.getByRole("link", { name: "注册 / 登录" }).count() === 0);
  await page.getByRole("link", { name: "个人主页" }).first().click();
  await page.waitForURL((url) => url.pathname === "/profile");
  check("邮箱只读且旧账号昵称未设置", await page.getByText(email).isVisible() && await page.locator("#nickname").inputValue() === "" && await page.getByText("邮箱暂不支持修改").isVisible());

  await page.locator("#nickname").fill("  产品探索者  ");
  await page.getByRole("button", { name: "保存昵称" }).click();
  await page.getByText("昵称已保存").waitFor();
  await page.reload();
  check("昵称保存后刷新仍存在", await page.locator("#nickname").inputValue() === "产品探索者");
  const invalidNickname = await post(page, "/api/profile", { nickname: " " }, "PATCH");
  check("服务端拒绝空昵称", invalidNickname.status === 400);

  const wrongPassword = await post(page, "/api/profile/password", { currentPassword: "wrong", newPassword: nextPassword, confirmPassword: nextPassword });
  const shortPassword = await post(page, "/api/profile/password", { currentPassword: originalPassword, newPassword: "12345", confirmPassword: "12345" });
  const mismatch = await post(page, "/api/profile/password", { currentPassword: originalPassword, newPassword: nextPassword, confirmPassword: "another" });
  check("修改密码校验当前密码、长度与确认密码", wrongPassword.status === 400 && shortPassword.status === 400 && mismatch.status === 400);

  await page.locator("#current-password").fill(originalPassword);
  await page.locator("#new-password").fill(nextPassword);
  await page.locator("#confirm-password").fill(nextPassword);
  await page.getByRole("button", { name: "修改密码" }).click();
  await page.getByText("密码已修改").waitFor();
  check("密码修改成功后清空输入", await page.locator("#current-password").inputValue() === "" && await page.locator("#new-password").inputValue() === "");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".scratch/profile-mobile.png", fullPage: true });
  check("390px 页面无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole("button", { name: "退出登录" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".scratch/profile-mobile-bottom.png" });
  check("390px 密码提交与退出入口可见", await page.getByRole("button", { name: "修改密码" }).isVisible() && await page.getByRole("button", { name: "退出登录" }).isVisible());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: ".scratch/profile-desktop.png", fullPage: true });

  await page.getByRole("button", { name: "退出登录" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.getByRole("link", { name: "注册 / 登录" }).first().waitFor();
  check("退出登录回首页并恢复游客入口", await page.getByRole("link", { name: "个人主页" }).count() === 0);
  await page.goto(`${base}/profile`);
  await page.waitForURL((url) => url.pathname === "/login");
  check("退出后个人主页受到认证保护", new URL(page.url()).searchParams.get("callbackUrl") === "/profile");

  await page.fill("#email", email);
  await page.fill("#password", originalPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByText("邮箱或密码错误").waitFor();
  check("旧密码不能再登录", await page.getByText("邮箱或密码错误").isVisible());
  await page.fill("#password", nextPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => url.pathname === "/profile");
  check("新密码可登录并恢复个人主页", await page.locator("#nickname").inputValue() === "产品探索者");
} finally {
  await context.close();
  await browser.close();
}

console.log(`结果：${pass} 通过，${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
