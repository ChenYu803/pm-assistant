# #15 停止后用量收尾的本地候选（2026-11-07）

用户授权代理立即修复停止后的计量与结算，同时本人通过既有受控通道验收其他人工项。风险 L2：共享 Stream/Completion、持久停止意图、资金终态与跨进程竞争。本记录仅对应本地候选，不代表目标环境通过或正式开放。

## 问题与修正

原 ai.ts 将 watchModelStop 的用户停止信号传给 SDK。用户停止后，供应商流在最终 usage 前被主动关闭；即使移除这一信号，消费方退出 for-await 仍可能调用上游迭代器的 return()，再次提前关闭连接。

修正让停止意图控制页面输出和结果采用，供应商请求使用独立的全程超时。流式计量层手动持有同一次请求的迭代器，消费者提前退出时先强制读取最新持久停止意图，再收取原流剩余的用量证据；不重发请求、不估算用量。Completion 保留原请求等待结果，但停止后不保存润色预览。

最终隔离反例还发现 SDK 在读取阶段捕获 AbortError 后直接返回 EOF，导致真实全程超时被记录为 interrupted。修正保留独立 upstreamSignal，在每次读取后确认时限；超时转换为现有 APIConnectionTimeoutError / failed / upstream_timeout 路径。正常读取和停止后的 drain 共用检查，不将用户停止意图当作超时。工作台、旧聊天及润色入口同步说明停止后后台仍可能生成和计费。

running/reserved 调用在停止事务内记录 stopped_collecting_usage，页面显示等待最终用量并保持原操作身份。可靠 usage、结束证据及适用价格齐全后按原结算规则扣一次、释放剩余预留；正常结束证据齐全但缺少可靠 usage 时转入 stopped/pending。缺失或未知结束证据为 interrupted/released；供应商明确失败、输出截断、真实断流、全程超时仍为 failed/released，免单并保留已知供应商成本，不因用户先点击停止而改为收费或待核对。原有24小时核对到期规则、资金终态保护及同会话预留互斥继续生效。

## 成本与产品边界

这项候选实现的是停止显示并等待后台原请求结束，不能称为立即停止供应商生成或计费。停止后的剩余生成也可能计入实际消耗；页面提前披露这一点。原 max_tokens 与原全程时限继续约束请求，但隐藏包装输入成本上界仍未经供应商证明。尚未取得可信的逐请求事后补查接口证据，不能承诺所有断流都可补回。

2026-11-06 原请求 f72654ce-4521-4770-abea-7869ad117d20 的连接和最终用量已经丢失，本修复不会凭空恢复其费用；保持既有待核对处理，不手工改账、不伪造为零。该笔317.088积分与下方隔离测试的314.176积分是不同请求。

当前不部署、不重启目标服务、不关闭受控连接。人工流程见 manual-acceptance-20261107.md；新操作须等待本人反馈再补真实结果。#15 保持 claimed，相关 AC 未勾选。

## 验证

核心红测已实际复现：场景5通过/3失败，停止接口返回后 provider closed=true、phase=closed-before-stop-usage-release，隔离调用314.176积分提前转 pending/stopped_usage_unconfirmed。原始证据目录 C:/Users/Administrator/AppData/Local/Temp/v141-stop-billing-wFXusP；日志 C:/Users/Administrator/AppData/Local/Temp/v144-stop-usage-red-20261107.log。属于本机替身证据，不是实际供应商调用。

审查发现另一个并发边界：最后一次停止轮询结束后、计量事务取得账号锁前，停止仍可能提交；已进入 processing 的结果也可能在正文保存前被停止。这两条路径必须使用相同的 finish 分类，不能将 length、缺失或未知 finish 直接改为可收费的 stopped。针对性回归区分“正常 finish 但无 usage”与“根本没有 finish”，避免混淆待核对和故障免单。

新增锁内竞态红测实际为场景38通过/12失败（竞态组35通过/12失败）、入口45通过/13失败。停止提交后再结算，以及 processing 后停止再补标，两条路径中的 length 与未知 finish 均误扣2.016积分，无 finish 则继续 pending。证据目录 C:/Users/Administrator/AppData/Local/Temp/v141-stop-billing-xkUgTO；日志 C:/Users/Administrator/AppData/Local/Temp/v144-stop-usage-processing-race-red-20261107.log。修正将共享分类下沉到计量模块的锁内终态和后处理补标；保留真实供应商成本，故障免单并释放，重复处理不改资金终态。

最终业务源码已通过 `npx tsc --noEmit`；输入草稿专项 `node scripts/verify-v144-composer-draft.mjs` 为15通过/0失败。九套相关回归及竞态针对组全部通过，所有运行正常退出并清理隔离资源。下表将场景断言与包含准备检查的入口计数分列，不相加；每个证据目录均位于 `C:/Users/Administrator/AppData/Local/Temp/`，保存 scenario-summary.json 与 summary.json。所有请求均使用本机 HTTP 供应商替身及随机隔离 MySQL，真实模型费用0，不触碰生产。

| 检查 | 场景通过 / 失败 | 入口通过 / 失败 | 证据目录 |
| --- | --- | --- | --- |
| 锁内/后处理停止竞态针对组 | 50 / 0 | 58 / 0 | v141-stop-billing-ku6Qux |
| verify:v144-stop-billing（最终完整15组） | 207 / 0 | 215 / 0 | v141-stop-billing-1j7Ywf |
| verify:v144-model-cost | 324 / 0 | 332 / 0 | v141-model-cost-6uR8ll |
| verify:v144-conversation-credits（适配后） | 57 / 0 | 65 / 0 | v141-conversation-credits-vTDdHc |
| verify:v144-polish-credits | 57 / 0 | 65 / 0 | v141-polish-credits-Rm9HEB |
| verify:v144-pending-usage | 24 / 0 | 31 / 0 | v141-pending-usage-5MZhlG |
| verify:v142-generation-stream | 17 / 0 | 24 / 0 | v141-generation-stream-yqJzZU |
| verify:v142-production-preparation | 60 / 0 | 67 / 0 | v141-production-preparation-IDuaQa |
| verify:v141-replay-foundation | 94 / 0 | 101 / 0 | v141-replay-foundation-zbtwGj |
| verify:v144-credits | 100 / 0 | 108 / 0 | v141-credits-shwVzO |

最终运行汇总：`C:/Users/Administrator/AppData/Local/Temp/v144-stop-usage-final-frozen-20261107.json`，状态 complete-all-final-green、剩余项为空，含命令与独立日志路径。核心账本及故障边界摘要：同目录 `v144-stop-usage-final-outcomes-20261107.json`。27份已有JSON解析、最终新增差异及两份新文档凭据特征检查0命中、`git -c core.autocrlf=false diff --check` 均通过。替身结果不证明真实供应商账单、立即停止计费或生产成本硬上界。

相邻回归首次运行发现旧测试契约：conversation 脚本仍要求 HTTP 500 后保留已被历史确认接纳的草稿，导致在正确清空的输入上重试超时。现改为先确认历史只含一条本次用户消息、草稿已消费、原请求身份仍保留，再重新填入同文重试；仍严格检查同 requestId、供应商调用仅一次、用户消息不重复、余额与流水 ID 集合不变。两个旧 replay 脚本只适配“停止显示”按钮名称，原 result 409、持久“生成已停止”和部分正文断言保留。未为旧脚本修改业务行为或删除幂等约束。

## 双轴审查

固定基线 fd1f59219b43e27ac722c826b705de40504752c3，审查当前未提交差异；最终报告不将静态审查当作测试或目标环境验收。

### Standards

最终硬违规0项、Fowler建议0项。包含共享停止分类、锁内结算和后处理、全程超时检查，以及新增六路径测试断言与协议快照。早期发现的故障优先级、轮询竞态及截断规则问题已修，源码增量和测试增量均已复核。最后新增的 conversation 重试与两个 replay 选择器适配也已增量复核，未新增硬违规或建议。

### Spec

最终未解决发现0项。此前P1“锁内停止转换及后处理绕过截断/未知结束免单”经红测复现后已修；正常 finish 无 usage 继续 pending，故障及缺失/未知 finish 免单，资金终态不追扣。后台继续生成收费、旧 pending 无法补回、真实供应商计量和成本上界限制仍保留；本地代码审查通过不代表#15通过或已获正式开放条件。最后新增的 conversation 与 replay 测试适配未放松防重请求、防重扣费或持久停止事实约束，增量未解决发现0项。
