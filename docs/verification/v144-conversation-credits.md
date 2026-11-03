# v1.44 #07 会话预留与可靠用量结算验收

日期：2026-11-03。风险：L2（金钱存储、真实并发和跨入口共享调用链）。基点：e9cfc4fbc2be0bd9e5d8cf440d58a1737d5feee4。

## 环境与安全边界

使用正式 Next 应用、随机独立 MySQL 库、正式账号鉴权/HTTP/浏览器及 localhost 供应商替身。应用 AI_MODE=live 仅用于访问 127.0.0.1 的受限替身；scenario 的 AI_MODE=replay 是保护开关，不代表应用绕过正式调用逻辑。没有请求官方模型，真实费用为 0；没有升级日常或生产数据库，没有目标机、生产部署或真实支付证据。

迁移 0029 在独立库从零建立并验证重复初始化、增量保留旧数据。购买来源只为隔离 legacy 账号构造，使用明确 fixture_opening 来源和同事务审计流水，不能冒充真实充值。各 runner 结束均清理本次随机库、账号和临时应用副本；证据目录保留。

## TDD 与问题修正

最小红灯在正式入口发现：零余额被接受且访问上游。证据目录 v141-conversation-credits-ACiM4b，scenario 0 通过/2 失败；runner 因全失败未接受摘要，不能把它当作通过报告。

首个最小绿灯为 v141-conversation-credits-VrUWAM，runner 10/10 通过。扩展专项首次运行发现测试控制端把 fetch Response.ok 当函数调用，修正后完整 47/47 通过（J5NSRp）。这是测试准备错误，不是资金实现通过证据的替代。

双轴审查后修正：未知 500/502 不清理请求身份；独立结算在账号锁后建立一致性读快照；模型终态与资金同短事务；逐来源消费/释放快照连续；生成中同步单次预留；按阶段设置实际输出上限，length 明确未完成并免单。新增断言经重跑通过。

## 最终检查

以下目录均位于 C:/Users/Administrator/AppData/Local/Temp/。

| 检查 | 结果 | 证据目录 |
| --- | --- | --- |
| verify-v144-conversation-credits.mjs | 62/62；scenario 54/54，4 工作流 | v141-conversation-credits-GIL6CF |
| verify-v144-model-cost.mjs | 332/332 | v141-model-cost-EBQQhD |
| verify-v144-credits.mjs | 108/108 | v141-credits-mRG6xk |
| verify-v142-production-preparation.mjs | 62/62 | v141-production-preparation-GinUQZ |
| verify-v141-replay-foundation.mjs | 101/101 | v141-replay-foundation-efnUhN |
| TypeScript / 定向 ESLint / 脚本语法 / diff | 全部通过；ESLint 0 错误、0 警告 | v144-credit-final-tsc.log、v144-credit-final-lint.log；本地语法/diff检查 |
| 生产构建 | npm run build 通过 | v144-credit-final-build.log |

仓库没有单一 test 全套命令，历史 verify 包含真实 LLM 脚本；本轮完整检查取与本次 L2 改动相关的资金、计量、额度、恢复与正式基础流程，以及静态检查和生产构建，不批量触发历史真实模型验证。

## 用户可见与持久结果

- 零余额返回 402、管理员没有免费通道、调用数不增加；用户输入和浏览器草稿保留，兑换/充值指引可见。无模型的项目/迭代/会话创建和浏览仍可用。
- 供应商 hold 期间真实观察来源冻结、资金总额守恒，同会话并行返回 409。不同会话真实并行共享余额；余额只够一次时并发结果为 200/402，上游只访问一次，已获授权者正常完成，无负余额。
- 正常结算释放未用预留，来源按赠送优先；已知购买夹具与 0.0005 赠送混合消费，逐笔核对两类来源和 before/after。消费小于 1 积分保留小数。
- 系统提示、历史及经过正式候选确认并选入上下文的完整文件实际发送给替身；以完整文件包含断言和历史哈希核对未截短，预算字节数与实际 max_tokens 一致。这里只验证完整性和公式，不证明隐藏聊天包装余量充分。
- 直接调用正式结算入口：生成进行中重试不提前释放；模型终态后的两次并发结算重试不新增消费或流水。
- 相同 requestId 返回原回复，改参数 409；故障重发保持 502，不再访问上游。浏览器模拟服务端已提交但收到 500 后，输入/身份保留，原样重试只读取原结果，不再调用或扣费。
- finish_reason=length 明确告知内容未完成，保留失败状态并释放预留，不静默生成成功候选。供应商故障免单与成本记录并存。
- 正常缺 usage、或可靠 usage 超预算，持久 pending/consumed=NULL，冻结保留且其他余额可用。真正停止并重启应用进程后，余额、待核对和原请求身份结果不丢失。
- 桌面与 390px 浏览器刷新显示全账号可用/冻结、本次预留和待核对；个人中心显示同笔调用。390px 无横向溢出，已查看桌面与移动端截图。删除业务迭代后资金、调用和名称快照仍保留。

独立预期账单（不是调用被测计价函数）：常规样本 input=1000、hit=400、miss=600、output=100，峰时人民币 0.002016 × 2000 = 4.032 积分，空闲 0.001008 × 2000 = 2.016；tiny 样本 input/miss/output=1，分别为 0.02/0.01 积分。正式 HTTP 只验证实际发生时段，未篡改生产时钟以冒充两个时段均 live。另一个成本专项覆盖独立双时段计算。

可复核文件：scenario-summary.json（逐项断言/余额观测）、provider-summary.json（替身调用和实际输出上限/输入哈希）、summary.json（隔离与清理）、scenario.log/server.log，以及 credits-zero-desktop.png、credits-pending-desktop.png、credits-pending-mobile.png、credits-profile-mobile.png。日志和截图保存在临时证据目录，不随源码提交。

## 审查与交接

固定基点双轴审查完成后复核：Standards 0 项未解决硬违规；Spec 0 项未解决。最初两轴发现的问题均已修正或按票明确的 #10 边界交接，未将后台恢复误写成本票成果。

输入预算限制、影响和最小修正见 [调用契约](../conversation-credit-contract.md)。离线 BPE 样本不能证明当前服务的隐藏包装硬上界，不宣称严格防透支；超预算待核对可能意味着网站承担差额。崩溃时的 reserved 自动恢复与 24h 到期仍由 #10 完成，#08 润色/#09 停止故障尚未交付，当前计费中间状态不能单独部署生产。
