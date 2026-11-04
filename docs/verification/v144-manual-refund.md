# v1.44 #12 人工退款验收记录

日期：2026-11-03 至 2026-11-04（Asia/Shanghai）。风险：L2。最终验收完成：完整 HTTP 455/455、浏览器 249/249、十项相邻回归 783/783，合计 1487/1487。定向绿灯及调试轮次不重复计入合计。

## 行为与边界

按原人工充值及购买来源计算可退金额，精确到人民币分，对应积分 ×1000；退款锁定独立于模型预留，复用排序账号锁。外部成功先独立持久化，内账失败保持锁定，只重试内部记账。未知外部结果不能按失败释放。管理员发起、别名关联及各阶段追加审计，客户端响应不明保留原身份；个人查询限定本人，后台支持筛选分页。

本次仅随机隔离库、本机 Next HTTP 与浏览器、供应商替身和隔离故障。真实用户资金为 0，真实模型费用为 0；未迁移日常/生产库、未部署、未 push。生产迁移与真实收退款操作不在本证据范围。

## 定向红灯与审查修复

四条真实业务红断言：同管理员与跨管理员的合并别名，在原退款完成后重试会新建退款；复用充值与赠送 requestId 也被错误接受。证据目录：`C:/Users/Administrator/AppData/Local/Temp/v141-manual-refund-oCg65d`，最终 54 通过 / 6 失败，含四条业务失败与覆盖/外层汇总失败，cleaned=true。修复使用全局 credit_entries 身份；hold 保存原 ID，reference 审计永久绑定别名与原退款，终态重放原笔。

Spec 还发现旧 mark-failed 草稿阻断 succeeded/held 的内部恢复；修复后查询到确定持久事实时展示冲突并显式转入 complete，未确定结果继续保留草稿。静态增量复核通过，浏览器结果见后续章节。整体实现前未保留完整初始红灯证据，不声称全程严格 TDD。

身份定向绿灯：`C:/Users/Administrator/AppData/Local/Temp/v141-manual-refund-Y6SxyE`，runner 60/0、场景53/0，identity-request workflow，cleaned=true。模型及并发定向：`C:/Users/Administrator/AppData/Local/Temp/v141-manual-refund-yQjo8z`，162/0，cleaned=true。完整运行 bS4oXj 因用户中断未形成完成证据，不计通过；续接核对并清理该次隔离资源后重新完整验证。

## 完整 HTTP 专项

最终有效证据：`C:/Users/Administrator/AppData/Local/Temp/v141-manual-refund-kkLW7Q`，455 / 0（场景 448 / 0，加运行检查 7 项），12 / 12 workflows，cleaned=true。覆盖 lifecycle、permissions-validation、idempotency、identity-request、transfer-failure、internal-failure-restart、response-loss、pagination-query、model-fraction、model-exhausted、model-protection、concurrent-account。

并发从应用入口同时发起，performance_schema 锁等待图实测 3/3、4/4 请求等待，保留等待及最终守恒断言。innodb_trx 同期可能读到 0，不能据此判定没有锁等待。旧 bS4oXj 中断运行未计通过；其随机库、账号、构建副本已清理，证据为旧目录 interrupted-cleanup.json。本次清理记录为最终目录 cleanup-audit.json。

## 相邻回归

每项计数只取有效最终运行，不累计失败调试轮次。十项最终有效回归共 783 / 0：

| 专项 | 通过 / 失败 | 隔离证据目录 |
| --- | --- | --- |
| v144-pending-usage | 31 / 0 | `C:/Users/ADMINI~1/AppData/Local/Temp/v141-pending-usage-MDAuMg` |
| v144-admin-unconfigured | 12 / 0 | `C:/Users/ADMINI~1/AppData/Local/Temp/v141-admin-unconfigured-MSQEQK` |
| v144-credits | 108 / 0 | `C:/Users/ADMINI~1/AppData/Local/Temp/v141-credits-445r2S` |
| v144-manual-recharge | 129 / 0 | `C:/Users/ADMINI~1/AppData/Local/Temp/v141-manual-recharge-QScSod` |
| v144-conversation-credits | 62 / 0 | `C:/Users/ADMINI~1/AppData/Local/Temp/v141-conversation-credits-nYbS3G` |
| v144-polish-credits | 65 / 0 | `C:/Users/ADMINI~1/AppData/Local/Temp/v141-polish-credits-yfCXQR` |
| v144-admin-controls | 89 / 0 | `C:/Users/ADMINI~1/AppData/Local/Temp/v141-admin-controls-tZE5jp` |
| v144-stop-billing | 123 / 0 | `C:/Users/ADMINI~1/AppData/Local/Temp/v141-stop-billing-HXjQTI` |
| v141-replay-foundation | 101 / 0 | `C:/Users/ADMINI~1/AppData/Local/Temp/v141-replay-foundation-nAO6xv` |
| v142-production-preparation | 63 / 0 | `C:/Users/Administrator/AppData/Local/Temp/v141-production-preparation-jSIOh6` |

以上均 cleaned=true。回归总记录：`C:/Users/ADMINI~1/AppData/Local/Temp/v144-12-final-WpBlV4`。

首轮由 Node 子进程缺失 Windows 程序目录与 Playwright 缓存变量导致浏览器启动失败；补充 PROGRAMFILES、PROGRAMFILES(X86)、PLAYWRIGHT_BROWSERS_PATH=D:/DevCache/ms-playwright 后，仅重跑受影响八项。生产准备另有既有测试等待竞态：消息 completed 与锁释放是分开提交，脚本原先只等消息；现同轮读取消息与锁，等待 completed、非空正文、无错误和锁释放全部成立，保留原 5 秒上限与原断言。补丁后有效结果为 63/0、7 workflows、cleaned=true；旧 50/2 不计通过。

## 浏览器与截图复看

最终证据：`C:/Users/Administrator/AppData/Local/Temp/v141-manual-refund-browser-Q89eLd`。runner 249/0、场景 242/0，四个 workflows：1440-lifecycle、1440-unknown-responses、390-lifecycle、390-unknown-responses。第 1 轮即通过，cleaned=true。

1440×1000 与 390×844 均通过真实 UI 发起、外部成功登记、失败释放、用户结果及余额核对；POST/PATCH 在正式 HTTP 持久成功后分别丢响应、返回500或缺 sourceId 的200，刷新后仍锁定原操作、原样重试，最终唯一扣账。旧 mark-failed 草稿经另一管理员确认 succeeded/held 后，明确展示持久事实冲突，显式核对并仅 complete，最终解锁本地草稿且完成内账。

28 张截图、28 次布局检查，pageerror=0、整页横向溢出=0，窄屏表格采用局部横向滚动。主线程已实际复看桌面与390px下的退款完成、旧草稿冲突、用户最终记录截图，以及未知响应样本，共9张；截图是视口截屏，长表格须局部滚动，完整内容和余额另有 DOM 断言核对。全部截图路径见 screenshots.txt，断言与布局见 scenario-summary.json，逐 AC 复核见 browser-review.md。

## 静态检查

`npx tsc --noEmit` 通过；19 个改动业务源码与 6 个改动/新增验证脚本的定向 ESLint 通过且零 warning；6 个脚本的 `node --check` 通过。日志与 SHA-256 文件快照：`C:/Users/Administrator/AppData/Local/Temp/v144-12-final-static/summary.json`。浏览器执行后逐文件 SHA-256 与静态检查快照一致，无遗漏修改。

## Standards

最终业务与验证脚本审查：文档规范硬违反 0 项，Fowler 12 项 smell baseline 有效建议 0 项。新增浏览器场景最初缺文件的验证阻断，已在补齐场景脚本及增量复核后关闭。最终对隔离边界、故障注入、草稿恢复、断言与清理证据均未发现新问题。

## Spec

最终对照当前票7项AC及规格9、10节和数据/异常要求：缺失或部分实现0项、扩范围0项、疑似错误0项，未解决0项。初审发现的旧失败草稿阻断内部恢复已修复并由两种宽度的真实浏览器闭环覆盖；身份别名、全局操作 ID、金额及并发边界由定向红转绿和完整 HTTP 专项覆盖。Standards 与 Spec 分别审查与报告，互不抵消发现。

## 构建与收口

全部隔离 runner 退出、清理记录确认、无 .next 隔离副本或相关 Node 进程后，串行 `npm run build` 退出0；编译、TypeScript 与35个静态页面生成通过。日志：`C:/Users/Administrator/AppData/Local/Temp/v144-12-final-static/build.log`。最终 `git diff --check` 通过。

工单7项AC已勾选并resolved；PROGRESS.md、实施地图与协议耦合快照同步，下一前沿#13，本轮不自动开展。根目录测试临时日志已按明确文件名归档至 `C:/Users/Administrator/AppData/Local/Temp/v144-12-root-evidence-20261104-123426`，未混入提交。

新增0032迁移仅在随机隔离库验证；正式环境需随发布票按备份纪律执行迁移及目标机验收。未使用真实用户资金、未调用真实模型、未部署、未push。
