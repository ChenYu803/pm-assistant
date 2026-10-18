# v1.42 #01：新工作台流式生成验收

范围：用户确认“生成时逐步显示回复”后的代码准备，覆盖发送、消息编辑重生成与重新生成。只使用本机隔离 MySQL 和 `AI_MODE=replay`，未调用真实模型、连接生产服务器或配置 Cloudflare。

## 协议与数据边界

- 浏览器以 `Accept: text/event-stream` 选择 SSE。`heartbeat` 每 15 秒发出；`token` 携带增量正文与真实消息 ID；`result` 携带业务状态码与原响应正文。SSE 开始后 HTTP 状态为 200，最终业务失败由 result 表达。
- 响应设置 `Cache-Control: private, no-store, no-cache, no-transform` 与 `X-Accel-Buffering: no`。这只约束应用输出，目标 nginx/CDN 是否实际转发仍须验收。
- 服务端每 500ms 串行写入部分正文，消息仍为 generating。完成消息、Markdown/任务候选、HTML 快照继续使用完整生成后的成功事务。
- 普通发送停止或断线保留 failed 的部分正文；编辑/重生成中止则清理临时回复并保留之前的成功消息与用户原文。失败内容不会成为正式候选或快照。
- 前端按消息 ID 合并累计正文；切走再切回不会重复显示部分回复。没有本地流的页面通过数据库轮询恢复进度，生成状态结束时再次读取终态。
- 不请求 SSE 的客户端继续接收 JSON，发送成功和编辑成功均保留原来的 HTTP 200。

## 验证方式

`npm run verify:v142-generation-stream` 从独立空库启动正式应用，使用浏览器操作和真实 HTTP 响应取消验证流式链路，结束后只清理本次随机创建的测试库与账号。首 token 前心跳采用同一服务端 helper 的短延迟检查；此检查没有模拟 Cloudflare。

生命周期回归保留 `scripts/verify-v141-iteration-lifecycle.mjs` 的业务断言，通过临时 harness 接入同一隔离启动器；仅调整首次编译等待时间、截图目录和摘要输出，未改历史脚本或票据。

## 2026-10-18 最终结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 流式专项 | 23/23（场景 16，环境与清理 7） | `C:/Users/Administrator/AppData/Local/Temp/v141-generation-stream-MEt3W5/summary.json` 与 `scenario.log` |
| 原生命周期隔离回归 | 63/63（原业务 56，环境与清理 7） | `C:/Users/Administrator/AppData/Local/Temp/v141-lifecycle-regression-MuBgi9/summary.json` 与 `scenario.log` |
| `npm run build` | 通过 | 编译、类型检查和页面生成成功 |
| `npx tsc --noEmit` | 通过 | 最终构建后退出码 0 |
| 本票相关 TypeScript/TSX/MJS 定向 ESLint | 通过 | 退出码 0 |

专项覆盖首正文前心跳、生成中实时显示与持久化、切走/切回不重复、停止后刷新恢复、正常终态、编辑与重生成，以及普通发送/编辑/重生成的真实 HTTP 断开。最终两个随机测试库与应用账号均已回收，临时生命周期 harness 已删除。

验证期间查出并修复 POST 成功状态误改为 201 的回归；最终原断言与流式专项均验证保留 200。首次编译需要较长等待，因此临时生命周期 harness 将等待上限设为 45 秒。生产构建会清理根 `.next`，而隔离测试的源码副本也在其下，二者必须顺序运行；曾因并行构建发生环境干扰的运行不计作通过证据，以上为无干扰重验结果。

## 部署时仍需验证

在目标域名下确认登录、文件写入、持续超过 Cloudflare 普通代理读超时窗口的真实生成、停止与断线、服务重启恢复及独立备份恢复。上线前仍需落实生产配置、nginx/TLS/进程管理和公开体验的模型费用边界；本专项不替代这些验收。
