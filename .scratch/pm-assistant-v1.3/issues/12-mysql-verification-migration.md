# 12: 验证基础设施迁移到 MySQL

**Parent:** #07 — MySQL 单库收口与综合验收

**What to build:** v1.2 已有的安全、交互、一致性和四环验证不再通过 Mongoose 造数或断言 MongoDB，而是使用 MySQL 空库、公开 API 和 MySQL 可观察数据继续证明相同用户行为。

**Blocked by:** #11 — 移除 MongoDB 生产运行依赖

**Status:** implemented-pending-mysql-verification

- [x] 盘点所有现有验证入口，为每项 v1.2 外部行为明确“迁移为 MySQL 专项、改为公开 API 造数、由新专项覆盖或有理由退役”的唯一归宿。
- [x] 仍有价值的 UI/API 专项移除 Mongoose、MongoDB 连接变量、ObjectId 夹具和集合级断言，改用 UUID/MySQL 数据及相同外部行为标准。
- [x] 已完成的 MySQL 初始化、账号/工作区、对话、成果、冻结、级联删除和 tab/消息变更专项形成不重复、可单独运行的覆盖矩阵。
- [x] 测试造数与清理只作用于明确的 MySQL 测试数据，不依赖旧 MongoDB，也不要求删除用户保留的 MongoDB 原库。
- [x] 所有日常回归固定使用 `AI_MODE=replay`；环境未就绪时明确报告未运行，不自动切换真实模型。
- [x] 静态搜索证明验证脚本和 npm 验证命令不再依赖 Mongoose/MongoDB；专项失败能保留足够的用户行为和数据库关联定位信息。

## 相关 spec

见 v1.3 spec 的“迁移验收”“Testing Decisions”和“测试 seam”。
