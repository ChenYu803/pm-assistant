# v1.44 #01 默认会话本地命名验收

日期：2026-11-02。票据：`.scratch/v1.44/issues/01-local-session-naming.md`。风险：L2。

## 实现与证据边界

默认名取首条用户原文前 10 个字素簇（`Intl.Segmenter`），保留空格、标点与组合字符，不额外调用模型。命名与首条消息在同一事务中落库；人工改名同时保存独立标记，回复终态不再写名称。新工作台提供原位改名，旧聊天仍可打开、发送和人工改名。

追加迁移 `0023_v144_session_manual_title` 只增加人工名称标记，未修改历史迁移或既有名称。迁移仅在本次随机隔离库验证；未操作日常数据库、生产库、生产配置或真实模型。

专项用浏览器、正式 API 和本机 HTTP 供应商替身观察实际请求。隔离服务虽走正式供应商 HTTP 封装，但 URL 被限制为 `127.0.0.1`、使用固定假 key，属于模拟证据，不代表本机真实 live 或生产验收。

## 红灯

实现前 TypeScript 通过。业务红灯断言为“浏览器发送后以原文前十字符命名并保留前导空格和标点”，证明旧行为不满足新规则；独立库和账号已清理。日志 `.scratch/v144-local-naming-red-2.log`；原始证据 `C:/Users/ADMINI~1/AppData/Local/Temp/v141-local-session-naming-B8bfx3/`。首轮因注册页冷编译 52 秒超过 45 秒导航限制而中断，不作为业务红灯。

## 最终验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 本地命名完整专项 | 94/94；场景 87/87、四流程完成，cleaned=true | [汇总](v144-local-session-naming/summary.json)、[场景](v144-local-session-naming/scenario-summary.json) |
| 供应商 HTTP 边界 | 31 次流式主回复，非流式 0 次；旧入口两轮只有两次主回复 | [请求摘要与原始证据哈希](v144-local-session-naming/provider-http-summary.json) |
| 原文空格渲染 | 侧栏和标题均为 pre；空格实际宽度 7.1875px / 8.796875px | [读数](v144-local-session-naming/first-title-rendering.json) |
| v1.42 流式生成完整专项 | 23/23；六流程完成，cleaned=true | `.scratch/v144-regression-stream-green.log` |
| 基础回放 | 未通过：9 通过、3 失败；退出登录后仍观察到认证，后续登录等待失败，cleaned=true | `.scratch/v144-regression-foundation-green.log` |
| 生产构建 | `npm run build` 退出码 0 | `.scratch/v144-production-build.log` |

专项覆盖中英文、短文本、前导空格、标点、十个空格组成的名称、emoji、家庭 emoji、组合重音及扩展汉字；四阶段统一规则；后续消息、编辑和重新生成不改名；首条前人工命名（包括“新会话”）、生成期间原位改名、刷新持久化、取消与焦点恢复；未登录、跨账号、跨迭代及无效名称的拒绝；旧资料创建、打开、聊天、人工名称持久化和已撤入口 404。

基础回放并未获得完整生命周期通过证据。只读诊断确认退出接口返回 200（158ms），脚本已等待导航后再查 session，故现有证据不支持简单增加等待；后续登录页可能被已登录跳转遮蔽。认证代理可能在读取 JWT session 时刷新 Cookie，与退出清除发生竞争，但缺少实际 Set-Cookie、响应顺序和浏览器 Cookie 证据，尚未归因，不宣称是已证明的预存问题，也不修改无关认证业务。流式专项和本票专项各自通过不能替代这项失败结果。

调试记录：首轮专项在 Playwright 的 SSE response.finished() 等待处被 8 分钟运行上限终止，缺少场景摘要；当轮 cleaned=true，但不算业务失败或通过。改用供应商到达、界面终态与持久状态核对后完整通过，同时纠正消息接口 200 契约与 legacy tab 返回结构。相邻回归首轮均遇到注册页冷编译导航超时；仅将导航上限调至 120 秒，未放宽动作或业务断言。

## 静态与视觉检查

`npx next typegen`、`npx tsc --noEmit` 通过。已删除路由的陈旧 `.next/dev/types` 生成文件已清理，不修改项目 tsconfig。改动文件 ESLint 无 error；`ChatArea.tsx` 的既有 effect 依赖有 1 条 warning，本票未修改该 effect。Impeccable detector 返回 `[]`。已人工查看 [390px 原位改名](v144-local-session-naming/session-rename-mobile.png) 和 [1440px 旧入口](v144-local-session-naming/session-naming.png) 截图；新工作台桌面标题另有实际渲染读数，未保存该状态的桌面截图。

## 审查与交接

固定基线 `4e3d2c8fc481381c396d87cc9058cbf50f4b3914`，以开工快照提取本票增量，分别进行 Standards / Spec 审查。工作区既有视觉、认证、部署等改动不纳入本票提交。Standards 未发现硬违反或需整改异味；Spec 发现侧栏空格被旧 CSS 覆盖、脚本误用 201 两项，均已修复，由完整专项验证，原 Spec 审查者复核关闭。
