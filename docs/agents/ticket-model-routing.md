# Ticket 模型路由参考纪律

**本文件存在的理由**：用户不应被迫阅读代码，才能决定每张 ticket 使用哪个模型。`to-tickets` 已经掌握需求、依赖和切片边界，因此由它在切分完成后生成一份面向人的模型路由参考；`/implement` 只把这份参考作为起点，并根据验证结果升级模型。

## 文件位置与职责

- 每个新 feature 在 `.scratch/<feature-slug>/model-routing.md` 生成一份参考文件。
- `spec.md` 和各 ticket 仍是产品事实与实现范围的唯一来源；模型路由文件不重复 PRD，不改变验收标准。
- 路由文件是推荐，不是强制。用户指定模型时服从用户；实现过程出现升级条件时，按本文档处理。
- 历史 feature 没有这份文件时不回填旧票。只有新运行的 `/to-tickets` 产物必须包含它。

## 模型角色

以下价格是用户提供的相对工作假设（Luna = 1，Terra = 10，Sol = 25），不是账单承诺；推荐依据是任务风险，不是模型名称本身。

| 模型 | 默认角色 | 适合的 ticket |
|---|---|---|
| Luna | 高频执行与验证 | L0/L1、单层 UI、常量/文案、静态检查、固定回放脚本 |
| Terra | 跨文件主力实现 | 规则明确的前端 + API、消息历史、数据库读写、综合验证脚本 |
| Sol | 高杠杆决策与高风险首轮 | prompt/PRD/任务切分、协议、流式状态、跨 Agent 共享逻辑、难以客观验收的任务 |

## 判定顺序

先按 ticket 本身判断，不凭文件数量猜难度。以下问题每个回答“是”记一分：

1. 是否同时跨越两个以上边界（prompt、前端、API、数据库、文件系统）？
2. 是否涉及流式输出、停止、重生成、删除、队列、冻结或其他顺序敏感状态？
3. 是否修改 `%%%FILE_BEGIN%%%`、`%%%FILE_END%%%`、`%%%SCOPE_FROZEN%%%` 或肯定词等共享协议？
4. 是否依赖两个以上 ticket，或会影响多个 Agent/页面？
5. 验收是否包含主观判断，不能完全由固定 replay 断言？

路由基线：0-1 分推荐 Luna，2-3 分推荐 Terra，4-5 分推荐 Sol。以下情况直接升档：共享协议至少 Terra；prompt、PRD、原型、任务拆分和产品范围决策默认 Sol。

## to-tickets 生成步骤

在用户批准切分草案、确定最终 ticket 集之后，按以下顺序完成：

1. 为每一张 ticket 逐项应用“判定顺序”，记录具体证据（例如“跨前端/API”“依赖 02 和 05”“有固定 replay”）。
2. 为每张 ticket 指定 `Risk`、`Primary model`、`Why`、`Verification` 和 `Escalate when`。
3. 生成 `.scratch/<feature-slug>/model-routing.md`，覆盖全部 ticket，编号和文件名与 `issues/` 完全一致。
4. 在文件末尾给出整体成本观察：Sol 使用在哪些高杠杆票，哪些票可由 Luna/Terra 承担；相对成本只做粗估，不伪装成精确 token 预算。

完成标准：每张 ticket 恰好出现一次；每个推荐都有 ticket 内证据；每个推荐都有验证方式和升级条件；用户不读源码也能据表选择模型。

## implement 消费步骤

`/implement` 读取顺序为：`AGENTS.md` → `implement-context-hygiene.md` → `model-routing.md`（若该 feature 是新生成的）→ `当前 ticket` → ticket 引用的 spec 章节。读取路由文件只为选择模型，不因此通读其他 ticket 或无关源码。

- 先使用 `Primary model`。
- 若只是局部类型、选择器或文案错误，继续在当前模型修复。
- 同一问题连续两轮仍未解决，升级到表中的 `Escalate when` 模型；出现协议不一致、跨模块回归或测试结果矛盾时直接升级 Sol。
- 升级时保留 ticket、已改文件、验证命令、失败输出和当前假设；不要让新模型从整个仓库重新盲读。
- `AI_MODE=replay` 是默认验证方式。只有需要确认 prompt 被模型理解时，才申请一次 `AI_MODE=live` 验证，并遵守 `AGENTS.md` 的报备、轮数和成本规则。

## 路由文件模板

```md
# 模型调用参考：<feature-name>

生成依据：`.scratch/<feature-slug>/spec.md`
成本假设：Luna=1，Terra=10，Sol=25（相对成本）

## 总体建议

一句话说明本批 ticket 的模型分层和成本重点。

## Ticket 路由

| Ticket | Risk | Primary model | Why | Verification | Escalate when |
|---|---|---|---|---|---|
| `01-<slug>.md` | L1 | Luna | 单层逻辑 + 固定验收 | `tsc` + `scripts/verify-xxx.mjs` | 同一问题两轮未解 → Terra |

## 给人的备注

只写会改变模型选择的注意事项；不要复制 spec 或 ticket 正文。
```
