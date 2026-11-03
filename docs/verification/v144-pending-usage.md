# v1.44 #10 待核对自动恢复验收

风险：L2，涉及共享计量与持久账务。测试边界沿用 v1.44 规格和 #09：真实应用 HTTP/API、隔离 MySQL、本机供应商/邮件替身，以及计量生命周期公开接口的竞争补充用例。没有生产用量注入路由。

## 实施内容

- pending 首次进入时间、原始分摊和账单终态均持久化；恢复进程每轮从数据库扫描，不依赖应用或网页内存。
- 正常结算与到期免单共用账号锁；满 24 小时后只释放本笔预留，重复任务不会重复扣费或释放。
- 迟到可靠证据按原结束时已核实的价格窗口补充；原窗口未核实时保持未知，禁止用核对当天价格替代。
- 崩溃遗留 running/processing 超过持久期限后免单或按已登记停止事实处理；暂时写入失败回滚并在下轮重试。
- 提供独立 CLI、systemd service/timer 和生产启用核验说明，见 [恢复机制](../pending-usage-recovery.md)。

## 证据

专项：**31/31，通过 4/4 workflows，cleaned=true**。证据目录：

- 目录：C:/Users/Administrator/AppData/Local/Temp/v141-pending-usage-MZ6oFO。
- summary.json 保存总计数、隔离库和清理结果；scenario-summary.json 保存 24 条场景断言与价格、余额及模型状态证据。
- reliable-evidence-before-expiry：期限内补齐可靠用量、重复证据与并发任务、跨价时段使用原请求已核实价格。
- expiry-evidence-races-and-retry：到期与证据竞争、释放写入失败回滚重试、新预留不受其他到期记录影响、免单后迟到证据只补网站成本。
- abandoned-process-recovery：另一个进程分别提交 running/processing 后直接退出；应用重启与并发任务回收冻结，已确认与未知成本分别保留。
- offline-expiry-and-idempotency：应用 HTTP 产生缺用量、其他余额仍可用、离线/重启后自动到期、重复运行不重复释放。

专项脚本及共享夹具语法、npx tsc --noEmit、生产代码和 CLI 的定向 ESLint 已通过。隔离时钟门禁轻量检查2/2：生产模式及不匹配的隔离库均在I/O前拒绝。Standards轴0项、Spec轴0项；基点feb20e9d939a8255a8b946d26b32bc6a709b3302，审查覆盖tracked diff及所有新增文件。生产构建 npm run build 通过；日志：C:/Users/Administrator/AppData/Local/Temp/v144-10-build-0b68deaff7d748b0a64b614df58df5d3.log。

| 相邻专项 | 通过 / 失败 | 证据目录（均在 C:/Users/Administrator/AppData/Local/Temp） |
| --- | ---: | --- |
| verify:v144-stop-billing | 123 / 0 | v141-stop-billing-qh17ys |
| verify:v144-polish-credits | 65 / 0 | v141-polish-credits-i3QnDN |
| verify:v144-conversation-credits | 62 / 0 | v141-conversation-credits-yCgKPi |
| verify:v144-model-cost | 332 / 0 | v141-model-cost-E9vrXl |
| verify:v144-credits | 108 / 0 | v141-credits-WMcSf1 |
| verify:v144-email-auth | 249 / 0 | v141-email-auth-pygucY |
| verify:v141-replay-foundation | 101 / 0 | v141-replay-foundation-bQjTVu |
| verify:v142-production-preparation | 63 / 0 | v141-production-preparation-AblY8z |

相邻专项合计1103/1103，全部cleaned=true，按顺序串行执行且没有失败重试。汇总报告：C:/Users/Administrator/AppData/Local/Temp/v144-10-adjacent-20b7f616c55f4a479c75877196098572/results.json，包含逐项stdout/stderr路径。专项与相邻回归共1134条通过。

所有已开展用例仅使用随机隔离库、本机供应商替身，真实模型费用 0。未操作日常/生产数据库、未修改凭据、未部署，目标机 timer 状态和真实计量仍须 #14 核验。
