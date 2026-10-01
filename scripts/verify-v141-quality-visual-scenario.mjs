// v1.41 #23：真实界面的几何、触控、排版与失败恢复证据；不伪造 AI 回复。
import { chromium } from "playwright-core";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.BASE_URL;
const output = process.env.V141_REPLAY_OUTPUT_DIR;
let pass = 0; let fail = 0; let browser; let page;
const assertions = []; const workflows = []; const screenshots = []; const geometry = []; const contrasts = []; const touchTargets = [];
function check(name, okay) {
  assertions.push({ name, okay: Boolean(okay) });
  if (okay) { pass++; console.log(`✅ ${name}`); } else { fail++; console.error(`❌ ${name}`); }
}
async function api(path) {
  const response = await page.request.get(`${base}${path}`);
  if (!response.ok()) throw new Error(`GET ${path} 返回 ${response.status()}`);
  return response.json();
}
async function mutation(path, action) {
  const pending = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() !== "GET");
  await action(); const response = await pending;
  if (!response.ok()) throw new Error(`${path} 返回 ${response.status()}`);
  return response.json();
}
async function readyInput() {
  await page.waitForFunction(() => {
    const input = document.querySelector('[aria-label="输入消息"]');
    return input && !input.disabled && ![...document.querySelectorAll("button")].some((button) => button.textContent === "停止生成");
  });
}
async function visibleBounds(locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1 && element.contains(hit);
  });
}
async function checkTouchTarget(label, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const reachable = await visibleBounds(locator);
  touchTargets.push({ label, width:box?.width, height:box?.height, reachable });
  check(`${label} 触控至少44px且实际可达`, Boolean(box && box.width >= 44 && box.height >= 44 && reachable));
}
async function checkContrast(label, locator, pseudo = null) {
  const fact = await locator.evaluate((element, pseudoElement) => {
    const parse = (value) => {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3) throw new Error(`无法解析颜色：${value}`);
      return [...channels.slice(0, 3), channels[3] ?? 1];
    };
    const over = (foreground, background) => [...foreground.slice(0, 3).map((channel, i) => channel * foreground[3] + background[i] * (1 - foreground[3])), 1];
    // 透明背景从文档白底逐层合成，避免把辅助文字误算成白底上的颜色。
    const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
    const background = ancestors.reduce((color, node) => over(parse(getComputedStyle(node).backgroundColor), color), [255, 255, 255, 1]);
    const foreground = parse(getComputedStyle(element, pseudoElement).color);
    const effectiveForeground = over(foreground, background);
    const luminance = (color) => color.slice(0, 3).map((channel) => {
      const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const light = luminance(effectiveForeground); const dark = luminance(background);
    return { foreground, effectiveForeground, background, ratio:(Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05) };
  }, pseudo);
  contrasts.push({ label, pseudo, ...fact });
  check(`${label} 文字对比度至少4.5:1`, fact.ratio >= 4.5);
}
async function measure(label) {
  const facts = await page.evaluate(() => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { x:box.x, y:box.y, right:box.right, bottom:box.bottom, width:box.width, height:box.height };
    };
    const regions = [...document.querySelectorAll(".workbench-grid > aside,.workbench-grid > section")].filter((element) => element.getClientRects().length).map(rect);
    const nav = rect(document.querySelector(".workbench-stage-nav"));
    const grid = rect(document.querySelector(".workbench-grid"));
    const disjoint = regions.every((left, i) => regions.slice(i + 1).every((right) => left.right <= right.x + 1 || right.right <= left.x + 1));
    return { viewport:{ width:innerWidth,height:innerHeight }, nav, grid, regions, disjoint, pageWidth:document.documentElement.scrollWidth,
      fits:document.documentElement.scrollWidth <= innerWidth && nav.y >= 0 && nav.bottom <= grid.y + 1 && regions.every((box) => box.width > 0 && box.x >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1) };
  });
  geometry.push({ label, ...facts });
  check(`${label} 导航与区域无重叠、无页面横向溢出`, facts.fits && facts.disjoint);
}
async function capture(label) {
  const path = join(output, `${label}.png`);
  await page.screenshot({ path, animations:"disabled" }); screenshots.push(path);
}

try {
  if (!base || !output || process.env.AI_MODE !== "replay") throw new Error("必须通过隔离 replay 入口运行");
  await mkdir(output, { recursive:true });
  const mode = await fetch(`${base}/api/verify/replay-mode`);
  if (!mode.ok || (await mode.json()).aiMode !== "replay") throw new Error("服务未通过 replay 门禁");
  check("服务端固定 replay，无真实模型", true);
  browser = await chromium.launch({ channel:"msedge", headless:true });
  for (const viewport of [{ width:1440,height:900 },{ width:390,height:844 }]) {
    const prefix = `${viewport.width}×${viewport.height}`;
    const compact = viewport.width <= 1100;
    const context = await browser.newContext({ viewport, reducedMotion:"reduce" });
    // Next 开发指示器不属于产品，沿用工作台专项的隔离方式防止其拦截底部点击。
    await context.addInitScript(() => {
      const insert = () => {
        if (!document.head || document.getElementById("verify-hide-next-indicator")) return;
        const style = document.createElement("style"); style.id = "verify-hide-next-indicator";
        style.textContent = "nextjs-portal { display: none !important; }"; document.head.appendChild(style);
      };
      new MutationObserver(insert).observe(document, { childList:true,subtree:true }); insert();
      window.__qualityXss = 0;
    });
    page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(60000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/register`);
    await page.fill("#email", `verify-visual-${randomUUID()}@test.local`);
    await page.locator('input[type="password"]').first().fill("verify-pass-1234");
    await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
    await mutation("/api/auth/register", () => page.locator('form button[type="submit"]').click());
    await page.waitForURL((url) => url.pathname === "/projects");
    await page.getByRole("button", { name:"新建一个项目",exact:true }).first().click();
    await page.getByRole("dialog", { name:"新建一个项目" }).getByRole("textbox").fill("跨院系大学生学习协作与知识管理平台".repeat(4));
    const project = await mutation("/api/projects", () => page.getByRole("button", { name:"创建项目",exact:true }).click());
    await page.getByRole("button", { name:"创建产品迭代",exact:true }).first().click();
    const drawer = page.getByRole("dialog", { name:"创建产品迭代",exact:true });
    await drawer.getByPlaceholder("例如：降低首次使用流失").fill("梳理首次体验与协作交付的产品迭代".repeat(4));
    await drawer.getByText("填写本轮目标", { exact:true }).click();
    await drawer.getByPlaceholder("这一轮最想改变什么？").fill("降低新用户理解成本，交付可验证的首轮方案。");
    const iteration = await mutation(`/api/projects/${project.id}/iterations`, () => drawer.getByRole("button", { name:"创建并进入工作区" }).click());
    const url = `${base}/projects/${project.id}/iterations/${iteration.id}`;
    await page.waitForURL(url);
    const region = () => page.getByRole("navigation", { name:"工作台区域" });
    async function conversation() { if (page.viewportSize().width <= 1100) await region().getByRole("button", { name:"对话",exact:true }).click(); }
    async function sessions() { if (page.viewportSize().width <= 1100) await region().getByRole("button", { name:/阶段会话/ }).click(); }
    async function files() {
      if (page.viewportSize().width <= 1100) await region().getByRole("button", { name:/文件与上下文/ }).click();
      else if (await page.getByRole("button", { name:"展开文件区" }).isVisible()) await page.getByRole("button", { name:"展开文件区" }).click();
      await page.getByRole("tab", { name:/项目文件树/ }).click();
    }
    const nav = page.getByRole("region", { name:"四环阶段导航" });
    for (const label of ["需求分析","原型设计","PRD","任务拆分"]) {
      await nav.getByRole("button", { name:new RegExp(label) }).click();
      const proceed = page.getByRole("button", { name:`继续进入${label}`,exact:true });
      if (await proceed.isVisible()) await proceed.click();
      await page.getByRole("button", { name:"开始本阶段工作" }).waitFor();
      await measure(`${prefix} ${label}空阶段`);
    }
    await nav.getByRole("button", { name:/需求分析/ }).click();
    const session = (await mutation(`/api/iterations/${iteration.id}/stages/analysis/sessions`, () => page.getByRole("button", { name:"开始本阶段工作" }).click())).session;
    await readyInput();
    const messagesPath = `/api/iterations/${iteration.id}/stages/analysis/sessions/${session.id}/messages`;
    const htmlPayload = '<img src=x onerror="window.__qualityXss=1"><script>window.__qualityXss=2</script>';
    await page.getByLabel("输入消息").fill(`请生成一份大学生协作平台需求分析候选，明确用户、功能范围与成功指标。\n以下内容只作为文本展示：${htmlPayload}`);
    await mutation(messagesPath, () => page.getByRole("button", { name:"发送消息",exact:true }).click());
    await readyInput();
    const userMessage = page.locator(".workbench-message.user .message-content").filter({ hasText:htmlPayload });
    check(`${prefix} 用户HTML输入保留为文本且不执行`, (await userMessage.textContent()).includes(htmlPayload) && await userMessage.locator("img,script").count() === 0 && await page.evaluate(() => window.__qualityXss === 0));
    await checkContrast(`${prefix} Agent正文`, page.locator(".workbench-message.assistant .message-content").first());
    await checkContrast(`${prefix} 用户正文`, userMessage);
    await checkContrast(`${prefix} Agent辅助标签`, page.locator(".workbench-message.assistant .message-label").first());
    await checkContrast(`${prefix} 用户辅助标签`, page.locator(".workbench-message.user .message-label").first());
    await checkContrast(`${prefix} 输入占位文字`, page.getByLabel("输入消息"), "::placeholder");
    const card = page.getByRole("region", { name:"需求分析文件候选",exact:true }).last();
    await card.getByLabel("文件名").waitFor();
    const filename = `需求分析-${"大学生跨院系协作平台首次体验".repeat(5)}.md`;
    await card.getByLabel("文件名").fill(filename);
    const confirmCandidate = card.getByRole("button", { name:"确认创建",exact:true });
    await confirmCandidate.scrollIntoViewIfNeeded();
    await measure(`${prefix} 长名称待确认候选`);
    check(`${prefix} 候选确认按钮实际可点击`, await visibleBounds(confirmCandidate));
    if (compact) await checkTouchTarget(`${prefix} 候选确认按钮`, confirmCandidate);
    check(`${prefix} Agent 正文有真实标题和列表排版`, await page.locator(".message-content h1,.message-content h2,.message-content h3").count() > 0 && await page.locator(".message-content li").count() > 0);
    await capture(`visual-${viewport.width}-candidate`);
    await mutation(`/api/iterations/${iteration.id}/sessions/${session.id}/candidates/${(await api(messagesPath)).messages.at(-1).candidate.id}`, () => card.getByRole("button", { name:"确认创建",exact:true }).click());
    await card.getByText("已写入", { exact:true }).waitFor();
    await files();
    await page.getByRole("button", { name:`加入当前上下文：${filename}`,exact:true }).click();
    await page.getByRole("button", { name:`已加入当前上下文：${filename}`,exact:true }).waitFor();
    await measure(`${prefix} 长文件名文件树`);
    await capture(`visual-${viewport.width}-files`);
    await page.getByRole("tab", { name:/当前上下文/ }).click();
    const removeContext = page.getByRole("button", { name:`从当前上下文移除 ${filename}`,exact:true });
    check(`${prefix} 长上下文名称可移除且不挡控件`, await visibleBounds(removeContext));
    if (compact) await checkTouchTarget(`${prefix} 上下文移除按钮`, removeContext);
    await checkContrast(`${prefix} 上下文辅助提示`, page.locator(".context-guidance"));
    await capture(`visual-${viewport.width}-context`);
    await page.getByRole("tab", { name:/项目文件树/ }).click();
    await page.locator(".project-tree-name").filter({ hasText:filename }).click();
    await page.getByRole("button", { name:"编辑正文",exact:true }).waitFor();
    check(`${prefix} 长路径预览关闭可达`, await visibleBounds(page.getByRole("button", { name:"关闭预览" })));
    if (compact) await checkTouchTarget(`${prefix} 预览关闭按钮`, page.getByRole("button", { name:"关闭预览" }));
    await page.getByRole("tab", { name:"文件详情与来源" }).click();
    await page.getByRole("heading", { name:"变更时间线" }).waitFor();
    check(`${prefix} 来源时间线及跳转信息可读`, await page.getByText("当前路径", { exact:true }).isVisible() && await page.locator(".file-source").count() > 0);
    await capture(`visual-${viewport.width}-source`);
    await page.getByRole("button", { name:"关闭预览" }).click();
    await conversation();
    await page.getByLabel("输入消息").fill("长状态回放与停止入口验证");
    await page.route(`**${messagesPath}`, (route) => route.continue({ headers:{ ...route.request().headers(), "x-pm-verify-stream-delay":"1" } }));
    const pending = page.waitForResponse((response) => new URL(response.url()).pathname === messagesPath && response.request().method() === "POST");
    await page.getByRole("button", { name:"发送消息",exact:true }).click();
    await page.getByRole("button", { name:"停止生成",exact:true }).waitFor();
    check(`${prefix} 生成中停止可达、阶段完成禁用`, await visibleBounds(page.getByRole("button", { name:"停止生成",exact:true })) && await page.getByRole("button", { name:"完成本阶段",exact:true }).isDisabled());
    await measure(`${prefix} 生成状态`); await capture(`visual-${viewport.width}-generating`);
    await page.getByRole("button", { name:"停止生成",exact:true }).click(); await pending;
    await page.unroute(`**${messagesPath}`); await readyInput();
    await page.getByLabel("输入消息").fill("切换与失败时保留的草稿");
    // 草稿只保存在本次打开的组件内存；通过同阶段会话切换制造读取失败，不刷新页面。
    await sessions();
    const secondSession = (await mutation(`/api/iterations/${iteration.id}/stages/analysis/sessions`, () => page.getByRole("button", { name:"新建会话",exact:true }).click())).session;
    const secondSessionRow = page.locator(`.session-row[data-session-id="${secondSession.id}"]`);
    await secondSessionRow.waitFor({ state:"attached" });
    // 停止后的消息读取可能改变选择序号，使新建合法地不自动切换；像用户一样显式选择已创建会话。
    await sessions(); await secondSessionRow.click();
    await page.locator(`.session-row[data-session-id="${secondSession.id}"][aria-current="page"]`).waitFor({ state:"attached" });
    await readyInput(); await conversation();
    await page.getByLabel("输入消息").fill("第二个会话的独立草稿");
    await sessions();
    await page.route(`**${messagesPath}`, (route) => route.fulfill({ status:503,contentType:"application/json",body:JSON.stringify({ error:"会话读取暂时不可用，请稍后重试。" }) }));
    await page.locator(`.session-row[data-session-id="${session.id}"]`).click();
    await conversation();
    await page.getByRole("heading", { name:"会话内容未能加载" }).waitFor();
    check(`${prefix} 失败禁用发送且重试可达`, await page.getByLabel("输入消息").isDisabled() && await visibleBounds(page.getByRole("button", { name:"重新加载会话" })));
    check(`${prefix} 读取失败仍保留原草稿`, await page.getByLabel("输入消息").inputValue() === "切换与失败时保留的草稿");
    await measure(`${prefix} 会话失败`); await capture(`visual-${viewport.width}-failure`);
    await page.unroute(`**${messagesPath}`);
    await page.getByRole("button", { name:"重新加载会话" }).click(); await readyInput();
    check(`${prefix} 重试后保留原草稿`, await page.getByLabel("输入消息").inputValue() === "切换与失败时保留的草稿");
    await sessions(); await page.locator(`.session-row[data-session-id="${secondSession.id}"]`).click();
    await readyInput(); await conversation();
    check(`${prefix} 第二会话保留独立草稿`, await page.getByLabel("输入消息").inputValue() === "第二个会话的独立草稿");
    await sessions(); await page.locator(`.session-row[data-session-id="${session.id}"]`).click();
    await readyInput(); await conversation();
    if (compact) {
      await region().getByRole("button", { name:/阶段会话/ }).click();
      await measure(`${prefix} 长会话名`); await capture("visual-390-sessions");
      check(`${prefix} 新建和删除会话触控至少44px`, await page.getByRole("button", { name:"新建会话",exact:true }).evaluate((element) => element.getBoundingClientRect().width >= 44 && element.getBoundingClientRect().height >= 44) && await page.getByRole("button", { name:/删除会话：/ }).first().evaluate((element) => element.getBoundingClientRect().width >= 44 && element.getBoundingClientRect().height >= 44));
      for (const size of [{ width:320,height:740 },{ width:768,height:900 },{ width:1100,height:800 },{ width:844,height:390 },{ width:1101,height:800 },{ width:1280,height:800 }]) {
        await page.setViewportSize(size); await conversation();
        await measure(`${size.width}×${size.height} 对话`);
        check(`${size.width}×${size.height} 发送按钮不被截断或覆盖`, await visibleBounds(page.getByRole("button", { name:"发送消息",exact:true })));
        await files(); await measure(`${size.width}×${size.height} 文件区`);
        if (size.width === 844 || size.width === 320) { await conversation(); await capture(`visual-${size.width}-conversation`); }
      }
      await page.setViewportSize(viewport); await conversation();
    }
    // 浏览器原生缩放按 CSS 视口减半验证重排，而不是仅放大截图。
    if (!compact) {
      await page.setViewportSize({ width:720,height:450 }); await conversation();
      await measure("1440桌面200%缩放等效CSS视口");
      check("200%缩放后核心发送可达", await visibleBounds(page.getByRole("button", { name:"发送消息",exact:true })));
      await page.setViewportSize(viewport);
    }
    await files(); await page.getByRole("tab", { name:/当前上下文/ }).focus(); await page.keyboard.press("ArrowRight");
    check(`${prefix} 文件视图键盘切换且焦点可见`, await page.getByRole("tab", { name:"本轮写入",exact:true }).getAttribute("aria-selected") === "true" && await page.getByRole("tab", { name:"本轮写入",exact:true }).evaluate((element) => element === document.activeElement && getComputedStyle(element).outlineStyle !== "none"));
    check(`${prefix} 没有浏览器运行时错误`, errors.length === 0);
    workflows.push({ viewport, projectId:project.id,iterationId:iteration.id,sessionId:session.id });
    await context.close();
  }
} catch (error) {
  check(`视觉专项异常：${error.message}`, false);
  if (page && output) await page.screenshot({ path:join(output,"visual-failure.png"),animations:"disabled" }).catch(() => undefined);
} finally {
  if (browser) await browser.close();
  if (output) {
    await writeFile(join(output,"visual-geometry.json"), JSON.stringify(geometry,null,2));
    await writeFile(join(output,"visual-contrast.json"), JSON.stringify(contrasts,null,2));
    await writeFile(join(output,"visual-touch-targets.json"), JSON.stringify(touchTargets,null,2));
    await writeFile(join(output,"scenario-summary.json"), JSON.stringify({ pass,fail,aiMode:"replay",workflows,screenshots,assertions,contrasts,touchTargets },null,2));
  }
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
