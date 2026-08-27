# 模型调用参考：PM Assistant v1.2

生成依据：`.scratch/pm-assistant-v1.2/spec.md`

成本假设：Luna=1，Terra=10，Sol=25（相对成本）

## 总体建议

v1.2 以 Sol 处理协议、流式状态、数据生命周期和任务交付边界等高杠杆票；Terra 承担规则明确的跨文件 API/UI 与验证整合；Luna 只适合局部静态安全逻辑或固定回放维护。所有验证默认使用 `AI_MODE=replay`。

## Ticket 路由

| Ticket | Risk | Primary model | Why | Verification | Escalate when |
|---|---|---|---|---|---|
| `01-markdown-safety.md` | L1 | Terra | 需要同时处理 Markdown 展示、安全协议和回归矩阵；安全误判会影响所有聊天内容 | 固定恶意 URL、属性注入、代码围栏与普通 Markdown 的 Playwright/渲染断言 | 同一安全输入两轮仍无法稳定降级，或出现页面结构回归，升级 Sol |
| `02-project-boundary-isolation.md` | L2 | Terra | 跨多个文件 API、tab 上下文和项目 ownership，包含参数错误契约 | 同用户双项目隔离、跨项目读写/加载/下载/润色、非法与不存在 fileId 的 replay/API 断言 | 出现跨路由 ownership 不一致、数据残留或测试结果矛盾，升级 Sol |
| `03-file-protocol-and-snapshots.md` | L2 | Sol | 涉及文件白名单、路径解析、大小限制、中间文件语义、HTML 资产和 Agent 上下文协议 | 合法/非法文件矩阵、3 MiB 边界、中间文件不可加载、HTML 多版本隐藏与回看断言 | 协议 marker、文件树、上下文加载或版本目录任一边界不一致，直接升级 Sol |
| `04-cascade-delete.md` | L2 | Sol | 跨多个 MongoDB 集合，涉及事务能力、物理级联、失败补偿和幂等重试 | 项目/工作记录删除后的集合级数据断言、故障注入后的补偿和重复请求 replay | 事务/补偿语义与实际部署能力冲突，或出现半删除结果，升级 Sol |
| `05-message-source-of-truth.md` | L2 | Sol | 涉及流式输出、服务端预创建、消息状态、停止和刷新对账，是共享消息协议 | 零 token 失败、停止 partial、刷新/重连唯一消息和服务端 ID 断言 | 出现双气泡、状态回退、无 ID 消息或 SSE/历史矛盾，直接升级 Sol |
| `06-generation-recovery.md` | L2 | Sol | 重生成、编辑重发和取消有严格先生成后替换顺序，依赖消息状态事实源 | 成功/失败/取消/重试/刷新场景的 UI、消息列表和历史一致性 replay | 旧历史丢失、替换非原子或重试重复，直接升级 Sol |
| `07-tab-concurrency.md` | L2 | Sol | 版本号、幂等键和多窗口冲突横跨发送、删除、文件和冻结等共享操作 | 并发请求、重复请求、版本冲突和用户手动决策提示的 API/UI replay | 冲突静默覆盖、幂等键失效或跨操作协议不一致，直接升级 Sol |
| `08-conditional-auto-naming.md` | L1 | Terra | 条件更新和竞态范围明确，主要跨自动命名服务与工作记录 API | 手动改名竞态、多 tab 自动命名和失败回退的 API/UI 断言 | 条件更新无法表达最新名称来源，或与 tab 并发协议冲突，升级 Sol |
| `09-explicit-freeze-protocol.md` | L2 | Sol | 替换现有肯定词协议，跨控件、确认 API、文档生成、文件写入和 tab 并发 | 自然语言负例、历史消息负例、重复点击、取消、生成失败和两阶段成功 replay | 任一旧协议路径仍可冻结，或状态/写入确认顺序不一致，直接升级 Sol |
| `10-message-file-provenance.md` | L2 | Sol | 跨消息、文件写入和重生成的一致性事件，涉及历史兜底与新协议并存 | 消息 A/B 同名文件负例、更新/保持不变选择、刷新重放和来源事件断言 | 来源误判、旧数据兜底污染新消息或文件一致性提示错误，直接升级 Sol |
| `11-ticket-version-delivery.md` | L2 | Sol | 涉及任务拆分 Agent 的交付格式、重新切分确认、版本目录和当前版本规则 | 无 Status/Implementation、替换/另存、`issues/vN/` 保留和最大版本当前判定 replay | 输出契约与产品决策冲突、版本混入或静默覆盖，直接升级 Sol |
| `12-v12-replay-regression.md` | L2 | Terra | 综合入口和覆盖报告依赖多个已完成专项，主要工作是编排与外部断言汇总 | replay 综合入口、专项退出码、覆盖矩阵和失败类别报告 | 出现专项结果矛盾、综合入口误调 live 或无法定位失败，升级 Sol |

## 给人的备注

- 优先把 `03`、`04`、`05`、`06`、`07`、`09`、`10`、`11` 视为高杠杆票；它们共享协议或跨越数据库、API、前端和流式状态。
- `01`、`02`、`08`、`12` 可以从 Terra 起步，但出现跨模块回归、协议不一致或连续两轮无法解决时直接升级 Sol。
- 路由是建议，不是强制；用户指定模型时优先服从用户。实现阶段读取本文件后仍须按实际验证结果升级。
