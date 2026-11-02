# v1.44：退出后会话被迟到响应恢复

日期：2026-11-02。关联：v1.44 #01 命名票的相邻回归。风险：L2。仅本地代码修复与隔离验证，未部署或推送。

## 问题与归因

原命名专项和 SSE 专项通过，但基础回放在退出后仍观察到已登录，随后登录页跳转、表单等待超时。继续跟进使用真实认证 HTTP、桌面与移动端浏览器，记录脱敏 Set-Cookie 与响应时序。

第一轮退出专项 15 通过、3 失败：串行 HTTP 能退出，1440px 浏览器失败，390px 偶然成功；退出响应同时出现有效会话 Cookie 续期和清除。原始证据位于临时目录 v141-auth-signout-xUfFQx。只从代理 matcher 排除 /api/auth 后仍有 16 通过、5 失败：退出响应仅清除，但旧 /api/auth/session 请求的迟到响应仍能重新设置有效 Cookie。原始证据位于临时目录 v141-auth-signout-5klmrB。这证明仅调整 matcher 不足。

依赖实现中的 NextAuth handleAuth 和 session action 在读取 JWT 时重新签发 Cookie。旧读取请求可以在退出完成后到达浏览器，恢复刚被清除的会话。

## 修复及行为影响

- 代理继续执行原鉴权与跳转，返回浏览器前移除非空会话 Cookie；精准排除 /api/auth 及其子路径，由认证路由自行处理 Cookie。
- GET/POST /api/auth/session 同样移除非空会话 Cookie。登录签发、退出清除、CSRF 及其他 Cookie 保留。过滤覆盖默认 Cookie、安全前缀和分片；空值清除不受影响。
- 登录期限固定为签发起最多 30 天，普通访问不再续期。session.expires 返回原 JWT 的真实到期时间。未新增持久撤销表或迁移。

## 最终结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 退出认证专项 | 30 通过、0 失败；场景 23/23，一条完整流程，cleaned=true | [汇总](v144-auth-signout/summary.json)、[场景](v144-auth-signout/scenario-summary.json) |
| Cookie 响应观察 | 只保存脱敏值，退出仅清除 | [脱敏记录](v144-auth-signout/auth-cookie-observations.json) |
| 原基础回放 | 21 通过、2 失败；场景 15 通过、1 失败，未完整通过 | [汇总](v144-auth-signout/foundation-summary.json)、[逐项断言](v144-auth-signout/foundation-scenario-summary.json) |
| TypeScript | npx tsc --noEmit 退出码 0 | .scratch/v144-auth-typecheck.log |
| 生产构建 | npm run build 退出码 0 | .scratch/v144-auth-build.log |
| 定向 ESLint | 0 error、2 warning；代理回调形参仅用于选定依赖重载 | .scratch/v144-auth-eslint.log |

专项覆盖串行 HTTP 注册/登录/退出、未登录 API 401、1440px 和 390px 的界面退出、登录页可访问与重新登录。可控竞态同时扣住真实 session 和受保护 API 响应，在正式退出返回成功后才释放两条响应，验证两者不续期、session 保持为空、业务 API 继续 401、登录页仍可访问。

原基础回放的“显式退出清除认证”和“原账号登录成功”现均通过。随后等待“开始本阶段工作”按钮 20 秒超时；当前视觉改版的工作台未提供该按钮标签，旧脚本定位未同步。此次未扩展修改工作台或基础脚本，未将局部通过表述成完整生命周期通过；后续仍需按当前界面适配该场景。

## 审查与边界

固定基线为本地命名提交 1cc82b7。Standards：无未解决发现，初轮错误日志脱敏问题已修复；Spec：无未解决发现，已复审固定期限与可控竞态。两轴只审本轮认证增量，排除用户原有 /prototype 放行与其他未提交改动。

全部验证使用随机空 MySQL 库、专用账号和隔离源码副本，AI_MODE=replay，无真实模型请求；两轮最终验证均 cleaned=true，未访问日常/生产数据库。本机结果不代替目标机 HTTPS、实际域名和发布验收。命名票此前基础回归失败记录保留，本记录提供后续归因与修复证据。
