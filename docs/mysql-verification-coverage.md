# MySQL 验证覆盖矩阵

本矩阵是 v1.3 #12 对基线中的 29 个旧 Mongo 验证入口（不含已有 7 个 `verify:mysql-*`）的唯一归宿记录。日常验证只使用
`AI_MODE=replay`；测试账号使用 `verify-<主题>-<时间戳>@test.local`，直接数据库夹具
仅写入该账号经公开 API 创建的 UUID tab 或项目。不会连接、读取、删除或清理任何旧数据库。

| 旧入口 | 唯一归宿 | 结论 |
| --- | --- | --- |
| `verify-agent-types` | 保留为 API/UI 专项 | 已无数据库直连；改为 UUID URL 契约。 |
| `verify-cascade-delete` | `verify:mysql-cascade-delete` | 项目/工作记录删除、回滚与重试均已覆盖。 |
| `verify-conditional-auto-naming` | `verify:mysql-conversation` | 对话完成、版本和并发的 MySQL 专项覆盖条件命名前置；旧测试钩子不再是产品契约。 |
| `verify-context-usage` | 保留为 `verify:mysql-context-usage` | 用 MySQL 测试连接为测试 tab 写入历史消息，保留用量增长、预警和异常降级断言。 |
| `verify-delete` | `verify:mysql-project-artifacts` | 文件、上下文与来源的删除关联已由项目成果专项检查。 |
| `verify-edit-resend` | `verify:mysql-conversation` | 编辑重发和替换历史已覆盖。 |
| `verify-explicit-freeze-protocol` | `verify:mysql-explicit-freeze` | 两阶段、绑定、幂等与锁定已覆盖。 |
| `verify-fixes` | 保留为 `verify:mysql-ui-fixes` | 保留历史消息渲染、滚动和已写文件不重复确认的 UI 断言。 |
| `verify-list` | 保留为 `verify:mysql-list-rendering` | 列表 DOM 与样式是独立渲染行为。 |
| `verify-markdown-safety` | 保留为 `verify:mysql-markdown-safety` | Markdown 安全边界不能由存储专项替代。 |
| `verify-message-file-provenance` | `verify:mysql-project-artifacts` | 文件来源、版本和失败回滚已覆盖。 |
| `verify-message-interactions` | `verify:mysql-conversation` | 该旧入口的消息复制、删除、重生成、停止和编辑行为由对话专项唯一负责；文件来源与 tab 物理清理分别属于其他专项的独立契约，不重复移植旧入口。 |
| `verify-message-recovery` | `verify:mysql-conversation` | 正式消息、失败/重试、停止、替换链与刷新已覆盖。 |
| `verify-prd-six-section` | 保留为 API/UI 专项 | 已无数据库直连；改为 UUID URL 契约。 |
| `verify-project-boundary` | `verify:mysql-project-artifacts` | 项目文件、上下文、跨项目和跨用户 ownership 断言由成果专项唯一负责；账号/工作区专项只负责其自身创建与关系契约。 |
| `verify-protocols` | 保留为静态专项 | marker 与显式冻结协议不依赖数据库。 |
| `verify-prototype-agent` | 保留为 API/UI 专项 | 已无数据库直连；改为 UUID URL 契约。 |
| `verify-requirement-analyst-discipline` | 保留为 API/UI 专项 | 已无数据库直连；改为 UUID URL 契约。 |
| `verify-tab-concurrency` | `verify:mysql-conversation` | requestId 重放与版本冲突已覆盖。 |
| `verify-ticket-splitter` | 保留为 API/UI 专项 | 已无数据库直连；改为 UUID URL 契约。 |
| `verify-ticket-version-delivery` | `verify:mysql-project-artifacts` | 完整集合、版本、下载和来源记录已覆盖。 |
| `verify-v1-flow` | 保留为 API/UI 四环专项 | 通过公开 API 与 UUID，保留四环用户交付断言。 |
| `verify-a11y` | 保留为 API/UI 专项 | 保留对话框、重命名、输入框和删除确认的可访问性断言；文件夹具使用 replay system-write 旁路。 |
| `verify-account-project-workspace` | `verify:account-project-workspace` | 已是 MySQL 专项，唯一负责账号、项目、工作记录、tab 关系与跨用户访问。 |
| `verify-file-protocol-snapshots` | `verify:mysql-project-artifacts` | 文件白名单、工作文档、快照与 UI 保存由成果专项唯一负责。 |
| `verify-401` | 退役 | 仅支持手工改坏 live API key，无法满足固定 replay 约束；错误提示仍由 MySQL 对话专项的 replay 错误断言与 UI 代码覆盖。 |
| `verify-v11-ticket01-audit` | `verify:mysql-ui-fixes` | v1.1 历史审计入口不再单列；文件更新、自动命名与空态行为由现行 UI/自动命名专项负责。 |
| `verify-v11-ux` | 退役 | 它是旧综合编排入口；#12 不建立综合入口，后续 #13 统一编排。 |
| `verify-v12-replay` | 退役 | 旧综合编排入口会重复执行迁移前 Mongo 专项；#12 只保留覆盖矩阵，综合编排与四环验收属于 #13。 |

## 现行专项边界

- 初始化：`verify:mysql-init`
- 账号与工作区：`verify:account-project-workspace`
- 对话、恢复、并发：`verify:mysql-conversation`
- 项目成果、来源、快照与 tickets：`verify:mysql-project-artifacts`
- 显式冻结：`verify:mysql-explicit-freeze`
- 项目/工作记录删除：`verify:mysql-cascade-delete`
- tab 和消息变更：`verify:mysql-tab-message-mutations`
- 独立 UI/安全：`verify:mysql-markdown-safety`、`verify:mysql-context-usage`、`verify:mysql-list-rendering`、`verify:mysql-ui-fixes`，以及现有 API/UI 与静态协议专项。

专项必须各自确认服务端处于 replay；缺少 MySQL 连接、浏览器或服务端时输出“未运行（环境未就绪）”，不降级为真实模型。
