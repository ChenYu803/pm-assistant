---
target: src/components/ProductIterationWorkbench.tsx
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:D:\\Project\\4.Project\\Agent2\\src\\components\\ProductIterationWorkbench.tsx"
target_fingerprint: "sha256:f86528c65e7c8d0fc412b0a281fae33380bf9cc7bbba8943036461b5645165ed"
target_path: "D:\\Project\\4.Project\\Agent2\\src\\components\\ProductIterationWorkbench.tsx"
timestamp: 2026-10-31T05-41-06Z
slug: src-components-productiterationworkbench-tsx
---
# 设计评审：四环工作台（暗色改造后）

Method: dual-agent (A: 43217e1b-a77c-468d-b88a-60b87c9340d8 · B: 5c6538f1-6e76-4d8d-b1d4-6193aaa2baa0)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | 停用阶段页签的序号一度只有 1.1:1（已修）；自转与拖拽有档位吸附反馈，但生成中的阶段缺少进度指示 |
| 2 | Match System / Real World | 3 | 四环命名与产物文件名（需求分析/原型.md/prd.md/issues）一致；但"闸门"存在三种叫法 |
| 3 | User Control and Freedom | 2 | 抽屉、风险对话框可关；阶段切换没有"退回上一步"，`⊞` 与主 CTA 同效 |
| 4 | Consistency and Standards | 2 | 首轮 1 分：排版身份分裂（宋体只在 landing）、hover 变白/变橙、区块层级反转（后两者已修） |
| 5 | Error Prevention | 2 | 删除会话与项目文件有二次确认；创建任务文件夹无确认 |
| 6 | Recognition Rather Than Recall | 3 | 右栏"当前上下文/本轮写入"常驻，阶段状态用文字+色标双编码 |
| 7 | Flexibility and Efficiency | 2 | 无键盘快捷键；无批量操作；power user 只能靠鼠标逐个点 |
| 8 | Aesthetic and Minimalist Design | 3 | 深色统一后干净；空状态留白过多，装饰性大数字几乎不可见 |
| 9 | Error Recovery | 2 | 有错误提示与撤销确认；错误色曾是暗底深红字（已修） |
| 10 | Help and Documentation | 2 | brief 与场景说明到位；工作台内部没有就地帮助 |
| **Total** | | **23/40** | **Fair — 可用但未打磨（首轮 21/40，修复 P0 后 +2）** |

## Design Specificity Verdict

**LLM assessment**：这套界面有真实的产品骨架——四环阶段、阶段会话、产物文件树、上下文栏，结构不是模板套壳；"纸与工作台"的隐喻在 landing 与工作台之间是连贯的。但换肤把这种连贯性打薄了：标题字体在 landing 是宋体、在工作台是无衬线，同一句"AI 产品现场"在三个页面是三种排版气质。真正属于这个产品的东西（四环阶段条、产物接力）反而最朴素，最容易在竞品里见到。

**Deterministic scan**：`impeccable detect --json` 对 `src/components/ProductIterationWorkbench.tsx`、`src/components/ProjectList.tsx`、`src/components/SiteNav.tsx`、`src/app/onboarding/brief/page.tsx` 全部返回 `[]`（exit 0）；用一份合成 TSX 做阳性对照，检测器确实报出 `overused-font` line 9，排除"被静默抑制"。静态扫描干净≠界面干净：本项目的配色全在 CSS 里，检测器结构上无法评估对比度，所以浏览器证据是主证据。

**Visual overlays**：注入成功——`live-server --port=8411` 起服务、注入 `detect.js`（3,110,068 字节）、页面上出现 2 个 `div.impeccable-overlay`，控制台报两条 `low-contrast`：①`1.1:1 (need 4.5) — #181813 on #1e1f19`（停用阶段页签的 `span.stage-index`）；②`4.4:1 — #d76a52 on #262720`（`button.task-folder-create`）。两条都指向真实缺陷，均已修复。

## Overall Impression

暗色化本身是成功的：landing 的暗色语言被正确地搬到了其余界面，工作台的三栏不再是"三块同色板"。但这次评审最重的两条问题都不是"颜色不够黑"，而是**文字与底色撞了**和**层级关系反了**——它们只有真在浏览器里量才算得出来。修完之后界面的第一印象从"换了皮的浅色应用"变成了"一个在暗处工作的台面"。最大的机会仍在排版：现在这套界面还没有一个统一的字体身份。

## What's Working

- **hover 是材质变化，不是亮度变化**。按钮悬停走的是"换一种纸/加一层边界"，而不是把底色刷白，这条纪律在深色下保住了层次。
- **语义结构扛住了换肤**。`aria-current="step"`、tablist、`role="alert"`、键盘可切换的阶段页签，在整轮改色里没有一处被破坏。
- **风险对话框把"Agent 已知/Agent 未知"分开呈现**，这是这个产品真正的差异化表达，比任何装饰都值钱。

## Priority Issues

### [P0] 珊瑚实底按钮上压着奶白字：2.26:1（已修）

- **What**：`.iteration-button-primary`、`.project-workspace-create`、`OnboardingExperience .primary`、`.scenePrimary`、`CareerAssessment .primary` 五处珊瑚按钮的文字是 `#e9dfc8`，实测 2.26:1；hover 到 `#df5e4d` 更差（2.71）。
- **Why it matters**：这是每个页面的主行动按钮。低视力用户读不出按钮文字，普通用户在亮珊瑚上也会觉得字"发飘"。
- **Fix**：`color:#171713`（`--on-coral`）。根因不是漏写，而是 `.page button{color:inherit}` / `.page a{color:inherit}` 的特异性 (0,1,1) 压过了 `.primary` (0,1,0)，把 `color:var(--on-coral)` 顶掉；已把两条重置改成 `:where()`，并给缺 `color` 的两条补上。
- **Suggested command**：`$impeccable harden`

### [P0] 三栏层级反了：chrome 比内容亮（已修）

- **What**：左栏与右栏 `#262720`，中间的阅读列 `#1e1f19`；8 个面值里相邻步长只有 1.02–1.08，全域 1.39。
- **Why it matters**：用户的目光应该落在内容上，但界面把最亮的面给了两侧工具栏。工作台看起来像"内容被夹在两块板子中间"。
- **Fix**：反转成 地面 `#0f100b` → 栏 `#1b1c14` → 内容 `#2b2c22`；实测栏→内容 1.22、地面→内容 1.35，内容上的 `#e9dfc8` 10.67、`#b1ab98` 6.16、`#ed6f5c` 4.73 全部达标。`/projects` 同步同一阶梯。
- **Suggested command**：`$impeccable layout`

### [P1] 排版身份分裂：宋体只存在于 landing

- **What**：`"Songti SC"` 只在 `src/components/LandingPage.module.css:11` 出现一次；其余页面写 `Georgia,"Times New Roman",serif`（这两个字体都没有汉字），中文实际回落到系统默认；工作台又被 `src/app/workbench-quality.css:26,40,47,61` 全部改回无衬线。
- **Why it matters**：同一个产品，landing 像一本装帧过的书，工作台像后台管理面板。用户从 landing 走进工作台时，品牌感直接断掉。
- **Fix**：抽一个 `--font-display` 到 `:root`（`"Songti SC","Noto Serif SC",Georgia,serif`），所有 `h1/h2/大标题` 用它；工作台标题不再单独覆盖。
- **Suggested command**：`$impeccable typeset`

### [P1] 标题上方堆 kicker/eyebrow

- **What**：`PROJECTS / WORKSPACE`（左栏）+ `SELECTED PROJECT`（标题上方）+ `AI开发工作流`（landing 转台上方）——同一屏出现两层"分类标签"。
- **Why it matters**：kicker 是"给设计稿凑层次"的常用手段，实际只是把标题往下推、稀释标题自身的重量；两层 kicker 更是同一句话说两遍。
- **Fix**：保留一层（左栏的品牌位），删掉标题上方那层；landing 的 `AI开发工作流` 若保留，改成与 `01 — 04` 同一行的小字。
- **Suggested command**：`$impeccable distill`

### [P2] 一个闸门三个名字，两个入口同一个动作

- **What**：同一个"开始本阶段"的动作在界面上有三种称呼；`⊞` 图标按钮与「开始本阶段工作」都调 `createSession()`。
- **Why it matters**：用户会以为这是两个不同的能力，点下去发现一样，信任感掉一格。
- **Fix**：`⊞` 改成纯展示或删掉；动作名统一成一个动词短语。
- **Suggested command**：`$impeccable clarify`

## Persona Red Flags

**Alex（效率型老手）**：工作台没有一处键盘快捷键，换阶段只能点页签；新建会话有两个入口却都不能用 `⌘/Ctrl+Enter` 触发；`.context-switch` 三个标签里第三个曾折行，需要多看一眼才能选。

**Jordan（第一次来的人）**：左栏 `PROJECTS / WORKSPACE` 与右栏 `SELECTED PROJECT` 两个英文 kicker 先于中文标题出现，第一眼读不到"这是什么页面"；停用的阶段页签序号曾低到 1.1:1，看起来像"这个阶段不存在"而不是"还没轮到你"；「开始本阶段工作」与 `⊞` 的差异没有任何文案解释。

**Sam（依赖辅助技术）**：修好前，主行动按钮文字对比 2.26:1，屏幕放大后基本糊在珊瑚底上；装饰性 196px 幽灵数字已标 `aria-hidden`，不会污染朗读；阶段页签的 `aria-current="step"` 正确，读屏能听出当前阶段。

## Minor Observations

- `color-scheme: dark` 已生效，滚动条与原生控件随主题变暗，不再有"亮滚动条切进暗页面"的割裂。
- `.iteration-updated`（"更新 · 今天 20:33"）在 ≤640px 隐藏，移动端靠标题区分迭代，信息密度合理。
- landing 转台的幽灵数字 `01` 与下方 `01 — 04` 索引重复表达同一件事，二者留一个即可。
- `/projects` 左栏按要求保持留白，没有为了"填满"加任何东西。

## Questions to Consider

- 如果工作台只留「开始本阶段工作」一个入口，把 `⊞` 拿掉，用户会不会更清楚"下一步"是什么？
- 宋体要不要成为全站标题字体？现在它只在 landing 出现过一次。
- 内容列比两侧亮 1.22 倍已经能读出来了，要不要再加一条 1px 顶部高光，让"这是一张纸"更明确？
