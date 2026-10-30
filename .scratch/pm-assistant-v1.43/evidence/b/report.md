# Assessment B

## CLI detector

依据 `detector.json`，共 11 条命中：9 条 `overused-font`、2 条 `side-tab`，均为 warning / slop。字体规则把 Inter、Roboto、Fraunces、Geist、Plus Jakarta Sans、Space Grotesk 视作过度常见字体；侧边标签规则针对卡片一侧的粗色强调边。输出是源码位置与片段级命中，不能单独证明页面的实际字体层级或视觉质量。

命中位置分布在 `CareerAssessment.module.css`、`LandingPage.module.css`、`OnboardingExperience.module.css`、`ProfilePage.module.css`，以及 `globals.css` 和 `MarkdownRenderer.tsx`。JSON 实际数量是 9 + 2；其中 ProfilePage 同一文件贡献 6 条字体命中（含 import/base 声明），不是 6 个独立页面问题。

## False positives

- `ProfilePage.module.css:20,34,41,55` 的字体栈以 `"Inter Tight"` 为首选，`Inter` 是后备字体。规则按片段中的字体名命中，未区分首选字体与 fallback；这 4 条不等同于页面把 Inter 当作实际主字体。文件的 `:15` 和 `:1` 确实直接使用/导入 Inter，因此其余相关命中并非都可归为误报。
- `MarkdownRenderer.tsx:21` 的 `border-l-2` 是 Markdown blockquote 的常规 2px 灰色边框，不是卡片上的粗彩色侧边标签，属于选择器语义误报。
- `globals.css:180` 的 coral inset stripe 确实存在，但挂在固定提示 toast 上，不是卡片。规则捕捉到了边缘强调形式，却把它归入 card side-tab 类别；是否需要调整属于视觉判断，CLI 命中本身不足以判定。
- 字体报告按 CSS 声明和导入逐条计数，重复声明会重复出现；检测器没有把同一字体的 import、fallback 与页面视觉层级合并评估。

## Browser evidence

`browser.json` 记录 5 个入口：桌面首页、移动首页、登录、注册和 `/projects`。前两者控制台分别报告 3、6 个 anti-pattern；登录、注册及 `/projects` 记录为无命中。`/projects` 此次实际落到 `/login?callbackUrl=%2Fprojects`，所以没有覆盖登录后的项目页。

五项的 `preflight.mutable` 都是 `true`，`visibleHumanPage` 都是 `false`。因此它们证明的是本次浏览器探测和截图采集结果，不能作为干净、无工具介入的人工作品页验收。首页截图可见检测器标注覆盖层（桌面顶部的 “TINY NUMBERED SECTION LABELS”、左侧 “LOW CONTRAST TEXT”；移动端顶部编号条和标题描边）。登录/注册截图没有这些检测器标注；可见左下角 Next 开发指示器。

## Overlay 与现场截图时效

B 的首页截图保留了检测器注入的标注，阅读底层页面时应把它们视为工具覆盖层，而不是产品 UI。登录、注册截图未见检测器覆盖层。

父 Agent 私有截图目录中的 7 张项目、迭代、workbench、profile 图片文件时间为本机 2026-10-30 00:00:23 至 00:00:31；私有 `summary.json` 列出 7 次采集，视口宽度为 1440 或 390，`scrollWidth` 与视口相等，字体状态为 loaded，`errors` 为空且 `cleanup` 为 true。相比之下，`docs/verification/v141-quality/summary.json` 的质量门开始于 2026-10-01 15:56 UTC；该旧质量门不能替代 10 月 30 日的现场截图。私有截图只说明对应页面在该次采集时的状态，不代表所有页面都已重新验收。

因 browser 记录没有 server-cleanup 字段，我只读检查了 `Get-Process`：未见项目的 `next`/Node 开发服务器或 detector 进程；仅见 Codex Node runtime 与 Edge 进程。没有终止任何进程。私有采集摘要另明确记载 `cleanup: true`。

## 遗漏范围

- 没有重跑 detector/browser，也没有重新捕获截图；本结论只基于既有 B JSON、截图、源码行和私有采集摘要。
- 未覆盖认证后的 `/projects`、workbench/profile 的 B 浏览器探测、其余 onboarding/assessment 页面及完整用户流程；私有截图属于独立现场采集，不扩张 B 的 browser 覆盖范围。
- detector 不验证无障碍、交互、响应式行为或最终视觉质量；`visibleHumanPage: false` 限制了把浏览器输出当作人工可见验收的程度。
- 未执行 LLM、业务数据写入或代码改动；仅新增本报告。
