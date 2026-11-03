# v1.44 #11 联系充值与后台人工入账验收

风险：L2，涉及实收购买积分、管理员权限、并发与持久账务。仅随机隔离 MySQL、本机正式 HTTP 与浏览器；无真实转账或真实 LLM 调用。

## 实施与边界

- 用户个人中心提供联系充值页，显示当前账号 ID、早期人工处理、先确认金额/积分/预计时间；不承诺即时或全天候服务。
- 未配置真实微信时明确未开放并提示请勿转账；隔离测试微信只作为页面验证夹具，不能用于生产。
- 指定管理员核验实收后按 1 元 = 1000 购买积分入账；人民币字符串与 bigint 定点计算，不用浮点数计算金额。
- 来源与审计同事务；参考号规范化并利用既有唯一索引跨账号/管理员防重。操作身份发送前保存在会话存储；网络、超时或未知结果保留原身份重试。
- 账本保留实付、原购买来源、操作者、业务说明及前后余额；详见 [人工充值契约](../manual-recharge-contract.md)。退款由 #12 实现，本票不模拟收款确认，不接在线支付。

## 专项证据

命令：`npm run verify:v144-manual-recharge`。最终 **129 通过 / 0 失败**，其中场景 **122 / 0**，5/5 workflows，cleaned=true。

证据目录：C:/Users/Administrator/AppData/Local/Temp/v141-manual-recharge-8j4Omx。summary.json 保存整体计数与清理结果，scenario-summary.json 保存逐条断言与工作流。

1. known-amount-permission-validation-audit：12.34 元精确发放 12340 购买积分，原赠送余额不变；完整审计、来源、实付可追溯；匿名、普通用户、非法金额/参数与跨站请求被拒绝。
2. concurrent-global-reference-and-atomic-rollback：同操作 8 路并发、跨管理员/账号的重复转账只入账一次；冲突返回原记录；审计插入故障时来源和余额全部回滚，解除后原操作成功一次。
3. browser-response-loss-persistent-retry：正常 UI 0.04 元发放 40 积分；提交已完成但响应丢失时，刷新仍保留原操作并安全重试，已知累计余额与全部实收逐一核对。
4. user-contact-record-filter-and-pagination：个人中心余额/明细、完整账号/邮箱/参考号筛选、每页 20 笔及实际下一页导航；390px 无整页溢出。
5. process-restart-contact-configured：应用重启后余额和流水保留，隔离配置联系方式后正确展示。

已人工复看 1440px 入账成功页与联系页、390px 入账页与未配置联系页；沿用现有视觉，未见布局溢出。截图：recharge-admin-normal-desktop.png、recharge-admin-mobile.png、recharge-contact-unconfigured-mobile.png、recharge-contact-desktop.png。

首轮专项的 4 个场景失败来自异步提交/导航等待不足，已保留业务断言并改用持久结果轮询、URL 及目标元素等待。

Spec 审查发现：已存在未知结果时，重试收到 403 或不完整的 200 JSON 会清除草稿。新增浏览器用例实际复现红灯（v141-manual-recharge-TKNTET，117 通过 / 12 失败，含完整工作流门禁），修复后完整重跑 129 / 0。两例均检查原 requestId、完整输入、sessionStorage、锁定/禁止另建、刷新恢复及中文提示；替身响应本身不新增真实资金来源。证据 recharge-unknown-response-ui.json，截图 recharge-pending-retry-403-desktop.png、recharge-pending-retry-empty-200-desktop.png，已人工复看。

## 回归与审查

| 相邻专项 | 通过 / 失败 | 证据目录（C:/Users/Administrator/AppData/Local/Temp） |
| --- | ---: | --- |
| verify:v144-credits | 108 / 0 | v141-credits-RGAwnR |
| verify:v144-admin-controls | 89 / 0 | v141-admin-controls-TJAiMB |
| verify:v144-admin-unconfigured | 12 / 0 | v141-admin-unconfigured-vRIeTh |
| verify:v144-email-auth | 249 / 0 | v141-email-auth-0DCFyh |
| verify:v141-replay-foundation | 101 / 0 | v141-replay-foundation-CpDv09 |
| verify:v142-production-preparation | 63 / 0 | v141-production-preparation-diZWjY |

各专项均 cleaned=true。管理员旧夹具首轮 34 通过 / 6 失败：字段白名单尚未适配 #04 余额，调用样本缺少当前计费所需余额、requestId 及可靠 usage。通过 git show HEAD 核实为既有夹具问题；只更新两份测试，从正式赠送接口创建已知测试余额，固定隔离模型并补齐协议数据，保留停用后拒绝、供应商零新增调用及正文保护断言。修复后一次完整重跑 89 / 0。

相邻回归合计 **622 / 0**，最终专项与相邻回归共 **751 / 0**，不累加早期失败轮次或重复运行。Standards 初审及修复增量复核均 0 项；Spec 的 1 项 P2 已修复并复核通过，未解决问题 0 项。基准 1ad66698088fb98dc46e7261a93d32e363124aca，审查覆盖 tracked diff 与全部新增源码。

最终 tsc、所有改动源码/脚本的定向 ESLint（0 warning）、专项与共享运行器语法及 git diff --check 已通过。串行生产构建 npm run build 已通过，确认隔离源码副本清理后才启动。最终摘要与逐轮日志归档：C:/Users/ADMINI~1/AppData/Local/Temp/v144-11-final-f89a5300407c4d4f87caa1a45993e5b5；构建日志 manual-recharge-build.log，汇总 final-summary.json。

## 发布前输入

运营者必须补齐并核实仓库外运行环境中的 RECHARGE_WECHAT_CONTACT，重启应用并在目标机确认。本轮只修改空模板，未配置真实微信、未修改生产凭据、未部署、未 push；没有真实充值或目标机核验。下一前沿为 #12 人工退款与原购买来源扣减。
