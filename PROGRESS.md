# PROGRESS.md - 项目状态与交接

> 本文件是 implement Agent 的单点交接摘要。每次会话开始必读，结束必更新。
> 具体产品决策见 `CONTEXT.md`，规格见对应 `.scratch/<feature>/spec.md`，票状态以对应 `issues/` 文件为准。
> 本文件只记录当前状态、下一步和仍会影响工作的事实，不重复规格和票的完整内容。

## 当前阶段

### v1.41：规格与 tickets 已收敛，等待原型输入与验收实施

v1.41 将重铸认证后的四环实践工作台，同时解决现有流程难用和视觉粗糙的问题。领域模型已经收敛为“项目拥有唯一文件树，产品迭代组织目标、四环状态和阶段会话”：需求分析、原型、PRD 和任务拆分文件均属于项目，用户通过上下文文件区域决定当前会话可以读取哪些正文。

`.scratch/pm-assistant-v1.41/spec.md` 已按 grilling 结论发布为 `ready-for-agent`，覆盖产品迭代身份与目标、四环一级导航、阶段状态和多会话、项目文件树、手动上下文、候选确认、纯 Markdown、内容修订与一次撤回、永久来源记录、任务拆分整套更新、删除语义、响应式工作台和视觉责任边界。v1.41 按全新数据库验收，不迁移或兼容旧数据；本次规格阶段未清空数据库。

实现前需要产品经理按 ticket 提供关键主流程原型或明确复用已有视觉来源。原型负责关键视觉层级、布局、控件和特殊交互，spec 负责行为、权限和数据事实；普通加载、失败、禁用、无特殊要求的移动端适配和技术实现由 Agent 按已确认方向补齐。两者在关键决策处冲突时必须在实现前显式处理，不能由 implement Agent 自行猜测。新增 `.scratch/pm-assistant-v1.41/v1.41-prototype-inputs.md` 作为 v1.41 专属的逐票原型交付清单，新增 `docs/agents/v1.41-implement-prototype-contract.md` 作为 v1.41 专属的 Implement Agent 开工检查和阻塞纪律；v1.41 最终验收票会删除后者并从 AGENTS.md 移除对应开工步骤。当前票据已按可独立演示的纵向切片重拆为 24 张草稿票；原型输入未齐前保持 needs-info，补齐并检查通过后再改为 ready-for-agent。

最高验收 seam 已确定为一条 `AI_MODE=replay` 四环浏览器全流程回放，通过真实应用、公开 API 和 MySQL 可观察结果覆盖创建产品迭代、四环状态、多阶段会话、候选确认、项目文件树、手动上下文、修订/撤回/删除、任务整套和迭代删除；旧 changelog 与旧文件模型断言必须退役。

### v1.4：#01-#06 已完成，入职体验全流程回放已收口

v1.4 已将原“A 路线”重新定义为正式功能“AI 产品经理入职体验”：用户扮演刚入职的 AI 产品经理，接手“大学生 AI 学习助手”这一入职任务，沿唯一顺序完成任务简报、工作场景判断和职场前辈反馈，最后完成职业认知测试并获取受保护的精炼学习笔记。

当前已完成落地页 HTML 原型接入、#01 入口边界和 #02 入职开场；后续原型按界面逐项制作，不要求一次性完成整个功能：

- 已有：落地页 HTML；
- 已有：落地页 HTML 已按原型视觉参数接入 `/`，入口行为按 #02 更新为进入 `/onboarding/brief`；
- 已有：任务简报 `/onboarding/brief` 与第一个工作场景 `/onboarding/scenes?scene=1`；
- 已有：03 完整工作场景序列 HTML 原型 `C:\Users\Administrator.DESKTOP-4HCDKBO\Desktop\prototype\work-scenes.html`；固定 6 个场景，场景 02 至 06 各含 2 个四选一判断；覆盖 AI 能力认知、AI 价值发现、人机协作、AI 提效和 Vibe Coding 成长位置；
- 已有：职业认知测试 `/onboarding/assessment`；
- 已有：#05 受认证保护的精炼学习笔记直接下载；游客注册或登录成功后自动下载，不新增文件查看页；
- 已有：#06 确定性浏览器回放，覆盖从落地页到测试结果页下载动作、认证边界、刷新重置和 B 路线首个 Agent 入口；未调用 LLM。

现有 6 张 tickets 已明确产品经理输入、Agent 责任和 Agent 不负责的范围。用户无论是否登录，点击“先认识 AI 产品经理”后都进入任务简报；工作场景选择只影响即时反馈，不改变唯一顺序；已体验记录仅保留在本次打开期间，刷新或重新打开后重置；提交十道题即完成测试且不设置及格线，十题全对只额外祝贺；测试结果页的精炼学习笔记下载需登录，认证成功后立即下载。

### v1.3：实现已收口，发布验收仍待环境

v1.3 的 MySQL 迁移实现已完成。#01 至 #12 已实现，#13 综合回放与发布验收入口已实现但尚未通过环境验收；父票 #07 只有在 #13 完成后才能关闭。

当前阻塞不是代码实现，而是 MySQL 应用连接凭据和完整业务回放环境尚未确认。`npm run db:init` 与 `npm run verify:mysql-init` 已成功，类型检查已通过；完整 MySQL replay 和从零四环人工冒烟尚未运行。

## 当前任务

1. 产品经理按 `.scratch/pm-assistant-v1.41/v1.41-prototype-inputs.md` 和各 ticket 提供关键主流程的 open-design 原型、明确复用来源或特殊行为/文案；不需要提供数据库、API、组件、system prompt、事务、测试脚本或每个普通异常状态的设计。关键输入未齐的票保持 needs-info，不得被 Implement Agent claim。
2. v1.41 当前按可独立验收的纵向行为拆分为 24 张草稿 tickets；19 号票准备验收基础设施，20-23 号票分别覆盖专项回放，24 号票执行从空库开始的完整连续回放、发布判断和 v1.41 专属纪律清理。
3. 实现阶段按 L2 协议改动处理；开发和验收从空 MySQL 数据库开始，不承担旧数据迁移。任何实际清库操作都属于后续实施步骤，不在规格会话执行。
4. v1.3 #13 的 MySQL 发布验收仍单独保留，不能用 v1.4 或 v1.41 的进度替代。

本次会话（2026-09-22）已新增用户手动调用的原型设计规范 skill：`C:\Users\Administrator\.agents\skills\ai-product-prototype-standard\SKILL.md`，事实参考位于同目录 `references/visual-standard.md`。该 skill 以 5 个产品原型为基线、以 `opendesign落地页.html` 为编辑化参考，并通过 `disable-model-invocation: true` 禁止 Agent 自主调用。

## 已完成版本

### v1.0

2026-08-11 验收通过。需求分析 → 原型 → PRD → 任务拆分四环流水线端到端走通；PRD 六章结构、issues 文件集、工作文档和概念版机制落地。`verify-v1-flow` 曾完成 82 条断言。

### v1.1

使用体验改进已完成：工作记录命名与一步创建、空状态引导、Agent 自我说明、消息复制/删除/停止/重生成/编辑、文件批量确认、上下文用量提示和文件一致性提示均已落地。综合 replay 覆盖 6 个专项、115 条断言，未调用真实模型。

### v1.2

规格与实现已完成，覆盖：

- Markdown 安全渲染；
- 项目边界隔离；
- 文件白名单、来源记录和 HTML 快照；
- 消息事实源、生成恢复和重试；
- tab 并发与显式冻结协议；
- 项目/工作记录级联删除；
- tickets 完整集合与版本交付；
- 条件自动命名和综合 replay。

固定回放入口完成 11/11 专项、165/165 断言，未调用真实模型。

### v1.3

MySQL 作为唯一应用数据库的实现已收口：

- #01 至 #06 完成 MySQL 初始化、账号/工作区、对话、项目成果、显式冻结和级联删除；
- #08 补齐 tab 与消息删除/截断；
- #09、#10 收口对话工作区和项目成果 API；
- #11 移除生产 MongoDB/Mongoose 运行依赖；
- #12 迁移验证基础设施；
- #13 创建综合回放与发布验收入口。

v1.3 不迁移旧 MongoDB 数据，不提供 MongoDB 回退，不新增用户可见功能。最终发布状态仍以 #13 的实际环境回放和人工冒烟为准。

## 验证状态

| 范围 | 当前结果 |
|---|---|
| v1.2 固定 replay | 11/11 专项、165/165 断言通过 |
| MySQL 初始化 | `npm run db:init` 成功；`npm run verify:mysql-init` 4/4 通过 |
| v1.3 类型检查 | `npx tsc --noEmit` 通过 |
| v1.3 综合 MySQL replay | 尚未运行，等待应用连接凭据和完整环境 |
| v1.3 四环人工冒烟 | 尚未运行 |
| v1.4 文档交付 | `PRODUCT.md`、spec、6 张 tickets、`CONTEXT.md` 和 `PROGRESS.md` 已按“无任务地图、无持久恢复、统一入口”收口；#04 十题测试文案已补齐至 `.scratch/pm-assistant-v1.4/assessment-content.md`；#05 已收敛为认证后的精炼学习笔记直接下载；`git diff --cached --check` 通过 |
| v1.4 #02 入职开场 | `/onboarding/brief`、`/onboarding/scenes?scene=1` 已实现；游客公开访问，四项全选后才可继续；第一个场景已按最新 HTML 原型同步题目/反馈双栏、固定反馈槽位、滚动显现与选项错峰入场、提交反馈和继续按钮动效；提交不自动滚动，刷新重置，浏览器冒烟覆盖桌面入口、反馈状态、刷新重置和 390px 移动布局 |
| v1.4 #03 工作场景原型 | `work-scenes.html` 已完成场景 02-06、10 个判断、正确/错误反馈、返回与唯一顺序推进、场景 06 测试入口；默认 A 变体及 B/C 结构变体已完成桌面与 390px 移动截图复核；场景简报已提升为主叙事区；场景 01-06 均使用滚动进入视口后一次性显现的 session 动效，选项从右向左以 1.05s / 160ms 错峰节奏进入，答题重绘不会重播已完成动效；选择题 session 预留固定反馈槽位和继续动作槽位，桌面端题目与反馈左右并列、继续按钮位于右侧底部，移动端自动堆叠；提交后题目与选项保持静态，仅反馈和继续按钮执行入场动效，提交路径不再包含任何平滑滚动；同场景下一题在原 session 内淡出/淡入替换且不滚动页面，最后一题跨场景仍回到顶部；已播放的底部 mentor/session 在重渲染时使用 `motion-static` 保持可见，不会因提交第一题重新播放；反馈槽位使用 `overflow-anchor: none` 防止布局变化触发浏览器滚动锚定；场景 01 进度统一为 `01 / 06`，进入场景 02 使用 `entry=1` 首访标记并强制注册新场景滚动动效；保留 reduced-motion 与 IntersectionObserver 不可用时的可见性兜底；未调用 LLM |
| v1.4 #03 工作场景实现 | 已接入 `/onboarding/scenes?scene=2..6`；固定场景 02-06、10 个四选一判断、预编排正确/错误反馈、连续推进和已体验场景回看均由 `WorkScenes` 承载；生产只采用原型 A 的结构，不实现 B/C 变体；场景 02-06 的答案和提交状态仅保留在当前页面内，刷新或重新打开后重置；底部“已体验场景”链接在本次打开期间以内存记录维持，不写入浏览器持久存储，场景 01 继续沿用 #02 的内存状态；回看场景 02-06 时不再恢复旧答案，但仍可通过本次打开期间的记录进入已体验场景；不创建游客服务器用户、项目、工作记录或进度数据；错误选择不改变顺序；场景 06 最后一题导向 `/onboarding/assessment`（由 #04 实现）；不限制手动输入 `scene` 查询参数；本次补齐场景 02-06 的 IntersectionObserver 滚动显现、选项错峰入场、反馈淡入、题目淡出/淡入切换、继续按钮显隐和 `entry=1` 首访重播，并修正应用滚动容器适配；同时仅对场景 02-06 扩展题目+反馈布局、统一动作按钮尺寸并恢复 02-06 的前辈语录与场景导航，901–1100px 自动堆叠反馈栏避免截断；场景根节点按实际内容高度布局，黑色导航作为页面底端且不额外拉长；“下一步项目动作”放入反馈四格右下位置，动作按钮不再强制上移覆盖反馈文字；首个 session 的动效在首次绘制前完成初始化，避免字段闪现后消失再重播。刷新重置是最终产品行为，不再由后续票增加恢复能力。 |
  | v1.4 #03 实现验证 | `npx tsc --noEmit`、`npm run lint`、`npm run build` 和 `git diff --check` 通过（lint 仅保留既有 `ChatArea.tsx` hook warning）；浏览器复测确认场景 02/03/04/05 选项存在且滚动后按 0/160/320/480ms 错峰入场，提交反馈可见并淡入，下一判断先淡出再入场，跨场景滚动复位，场景 01 和 390px 移动布局无横向溢出；另验证无 `IntersectionObserver`/`requestAnimationFrame` 的浏览器环境会静态显示全部内容并保持可交互；控制台无错误，未调用 LLM。 |
  | v1.4 #04 实现验证 | `/onboarding/assessment` 浏览器专项 14/14 通过；固定十题、十题全选后启用提交、提交确认、答题页 `THE DECISION ROOM` 引导、提交后回到页面顶端、复盘页 `MENTOR REVIEW` 左右排版、13px 题目说明、十题逐题解析、重测清空、390px 无横向溢出均已验证；原有认知文件回跳语义将在 #05 改为下载目标；`npx tsc --noEmit`、`npm run lint`、`npm run build`、`git diff --check` 通过。 |
  | v1.4 #05 实现验证 | `/api/onboarding/career-document` 已提供认证保护的 UTF-8 Markdown 附件响应；游客直链返回 401 且不泄露正文，注册或登录成功后无需再次点击即下载，已登录用户从结果页直接下载；文件名固定为 `AI产品经理职业认知-v1.0.md`，下载内容与产品源文件逐字节一致（SHA-256 `11D540E11EED2B1757971EEAA0DB79413A4C22C01E6B2510382D4848CBE119D6`），不创建下载数据库记录；浏览器专项 23/23、`npx tsc --noEmit`、`npm run lint`、`npm run build` 和 `git diff --check` 通过，lint 仅保留既有 `ChatArea.tsx` hook warning，未调用 LLM。 |
  | v1.4 #06 实现验证 | 新增 `npm run verify:onboarding-experience`（111/111）：游客与已登录用户均从落地页经任务简报、六个工作场景、十题测试、错题复盘/连续重测/全对反馈到下载动作；覆盖错误选择不分支、本次打开期间回看、刷新和同一浏览器上下文重新打开后重置、390px 场景反馈和结果页无横向溢出、游客 401 不泄露、认证后与已登录直接下载且正文逐字节一致，以及 B 路线游客认证、项目、工作记录和首个需求分析 Agent 入口。`npm run verify:career-assessment` 23/23、`npx tsc --noEmit`、`npm run lint`、`npm run build`、脚本语法和 `git diff --check` 通过；未调用 LLM。完整总入口 HTML 未提供，未做其逐像素视觉对照。 |
| 真实模型验证 | 当前未运行；默认使用 `AI_MODE=replay` |

### 本次文案交付

- #04 十题职业认知测试文案已重写为十道教育业务新情境迁移题，不复用工作场景原题，也不向用户展示场景关联或设置场景回溯限制；难度定位为初级 AI PM 面试级，重点考察取舍与验证。
- 题目重点覆盖传统 PM 基础、用 AI 提升 PM 工作效率、发现 AI 能满足的有效市场需求、能力评测、人机协作和岗位责任；Vibe Coding 仅用一题说明超级个体的进阶位置。
- 已补齐测试开始、答题中、提交、结果、逐题解析、直接重测、无限重试、全对额外祝贺，以及游客/已登录用户完成后的认证分流文案；提交即完成测试，不设置及格线，分数不拦截精炼学习笔记下载。
  - 文案明确测试只记录本次固定题目的作答情况，不推断职业能力、职业适配度或求职意愿；`assessment.html` 已接入正式页面。
- #05 固定职业认知正文与下载交付均已完成：`.scratch/pm-assistant-v1.4/career-document.md` 定为 v1.0、UTF-8 Markdown，覆盖定义、工作方式、相邻岗位、AI 提效与价值、人机协作、可靠性、交付物、Vibe Coding 和入职体验回顾；认证保护、已登录直接下载、游客认证后自动下载和稳定文件名均已接入，不制作 `career-document.html`。

## 约束与坑

- #03 工作场景底部回溯提示已明确说明：进度仅保存在当前打开期间，刷新或重新打开标签页后会重置；URL 仍会保留当前场景编号，但已体验场景记录会回到初始状态。

- **验证模式**：日常验证固定使用 `AI_MODE=replay`，不自动切换 live。真实模型只用于明确批准的 prompt 理解验证。
- **验证时长**：预计超过 10 分钟或需要真实模型的验证，先说明假设、轮数、耗时和成本，获得同意后再运行。
- **MySQL 验收**：#13 必须区分环境、schema、业务回归和测试夹具问题；不能以“代码已实现”替代发布验收。
- **Next.js 版本**：仓库使用 Next.js 16.3。写 Next.js 代码前先阅读 `node_modules/next/dist/docs/` 中的相关指南。
- **协议标记**：`%%%FILE_BEGIN%%%` 等 marker 与多个 verify 脚本耦合；修改文件协议前先查 `docs/agents/implement-context-hygiene.md` 的快照并做 L2 回归。
- **文件边界**：正式根文件、受控 `issues/` 路径和 HTML 快照有不同边界；非正式文件名可能被白名单拒绝，验证 fixture 必须遵守当前契约。
- **UI 文案耦合**：verify 脚本会点击真实按钮。修改按钮名称或流程前，先搜索 `scripts/` 中的旧文案，并至少运行一个受影响的非 LLM 专项。
- **辅助功能不可阻塞主流程**：自动命名等辅助调用必须有超时和失败降级；不能因为辅助功能挂起聊天或主流程。
- **v1.4 已体验记录边界**：#03 只在本次打开期间保留已体验场景，刷新或重新打开后重置；不提供任务地图、中断后继续、浏览器持久进度或服务端进度。
- **超时不变量**：`verify-v1-flow` 等待时长与聊天上游超时必须同步考虑，不能只改一侧。
- **保留用户改动**：当前工作区已有用户未提交内容，不得回退或清理。

## 当前工作区注意事项

以下改动不属于本轮 v1.41 规格交付，后续操作必须保留：

- `.codex/config.toml`：用户/其他会话的未提交修改；
- `.scratch/scene2-bottom-check.png`、`.scratch/scene2-layout-check.png`：#03 视觉检查截图。

本轮只提交 v1.41 的 `CONTEXT.md`、spec、原型输入契约和 tickets；尚未修改实现代码或数据库。提交后 push 仍需用户明确确认。

## 本机开发环境（2026-09-13 新系统恢复）

- 开发工具已独立配置在 D 盘：Node.js 24.21.0 LTS / npm 11.19.0 位于 `D:\DevTools\Node`，Git for Windows 2.54.0 位于 `D:\DevTools\Git`，MySQL Community Server 9.7.2 位于 `D:\DevTools\MySQL-9.7.2`；用户 PATH 已配置，Git 身份沿用旧系统配置，GitHub HTTPS 凭据将在首次需要认证时由 Credential Manager 获取。
- npm 缓存位于 `D:\DevCache\npm`，Playwright Chromium、Headless Shell、FFmpeg 和 Winldd 位于 `D:\DevCache\ms-playwright`；项目依赖已通过 `npm ci` 按锁文件重建。npm 报告 4 个上游依赖告警（3 high、1 critical），未擅自运行会改变依赖版本的 `npm audit fix` / `--force`。
- MySQL 数据目录位于 `D:\DevData\MySQL-9.7.2\Data`，Windows 服务名为 `PMAssistantMySQL97`、启动类型 Automatic；`npm run db:init` 成功，`npm run verify:mysql-init` 4/4 通过。旧 E 盘 MySQL 数据未迁移。
- `.env.local` 保持 `AI_MODE=replay`，并已为新系统生成新的本地 `AUTH_SECRET`。Next.js 在当前 Codex 文件隔离层向加密的 `%APPDATA%\nextjs-nodejs\Config` 执行同目录 rename 会错误返回 `EXDEV`；用户环境已设置 `NEXT_TELEMETRY_DISABLED=1`，设置后 `npm run build` 完整通过。
- 新环境验证：`npx tsc --noEmit` 通过；`npm run lint` 0 error、保留既有 `ChatArea.tsx` hook warning；`npm run build` 通过；Playwright Chromium 与系统 Edge 均可启动；开发服务器页面标题、可见性和控制台检查通过。
- 旧 Codex 数据已原样备份到 `D:\Backups\Codex\old-system-2026-09-13\.codex`（7,322 文件、1,715,977,434 bytes，关键数据库与索引哈希一致）；当前新系统数据在合并前备份到 `D:\Backups\Codex\new-system-before-merge-2026-09-13`。已将旧 Agent2 的 225 个可见线程、272 个会话文件、148 条索引和 25,871 条历史消息项按 ID 合并到新库，保留本机现有线程；两个 SQLite 库 `integrity_check=ok`、外键错误 0。Codex 桌面端需退出并重新打开后刷新侧边栏缓存。
- 2026-09-14 修复聊天历史迁移遗漏：续接 rollout 的 `history_base.thread_id` 与文件名后缀线程 ID 已递归纳入；演练及当前库合并后，“梳理 FDE 项目简历写法”关联线程计数为 1/47/5，两个 SQLite 库完整性 `ok`、外键错误 0。需退出并重新打开 Codex 让侧边栏刷新。

## 文档地图

- 产品决策与领域词汇：`CONTEXT.md`
- 当前规范：`.scratch/pm-assistant-v1.41/spec.md`
- 当前实现票：已重拆 `.scratch/pm-assistant-v1.41/issues/01-` 至 `24-` 共 24 张草稿；19-23 号票为专项验收，24 号票为最终发布闸。各票等待产品经理补齐关键主流程原型或确认复用后进入 ready-for-agent
- v1.4 历史规范与票：`.scratch/pm-assistant-v1.4/spec.md`、`.scratch/pm-assistant-v1.4/issues/`
- v1.3 历史规范：`.scratch/pm-assistant-v1.3/spec.md`
- 实现纪律与协议快照：`AGENTS.md`、`docs/agents/implement-context-hygiene.md`；v1.41 专属原型清单：`.scratch/pm-assistant-v1.41/v1.41-prototype-inputs.md`；v1.41 专属原型纪律：`docs/agents/v1.41-implement-prototype-contract.md`
- 架构决策：`docs/adr/`
