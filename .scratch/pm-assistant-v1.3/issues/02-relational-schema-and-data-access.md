# 02 — 关系模型与数据访问替换

**What to build:** 将现有 MongoDB 持久化对象转换为 MySQL 关系模型和统一数据访问边界，保留 ownership、标识符、唯一约束、排序、状态、时间和消息关联语义。

**Blocked by:** #01 — MySQL 运行时与初始化基础

**Status:** ready-for-agent

- [ ] 为 User、Project、WorkRecord、Tab、Message、ProjectFile、AgentFileContext、PrototypeSnapshot、TabOperation、MessageFileWrite 建立可追溯的关系型表示。
- [ ] 明确父子关系和多对多关系，保证项目 ownership 与跨项目访问隔离可由数据库约束和数据访问层共同验证。
- [ ] 将 ObjectId 依赖转换为统一、可安全序列化且能维持现有 URL/API 边界的标识符方案。
- [ ] 保留消息替换链、冻结引用、文件来源、tab 操作幂等记录等自引用/关联关系。
- [ ] 重建组合唯一约束、排序索引、时间索引、状态索引和 request id 幂等约束，并明确历史可空字段的默认/回填语义。
- [ ] 对 JSON/Mixed 类型、文件正文和 HTML 快照正文选择可查询、可保存且不截断内容的 MySQL 表达。
- [ ] 为所有查询提供统一的 ownership 过滤边界，禁止让单个路由绕过父级项目校验。

## 相关 spec

见 v1.3 spec 的“关系模型”“标识符”“一致性”和“数据断言”。

## 验收标准

- 空 MySQL 初始化后所有模型结构和约束可创建，重复初始化不产生重复约束。
- 使用 API 创建并读取关联实体时，ID、排序、状态、时间、唯一性和 ownership 结果符合 v1.2 外部行为。
- 跨项目访问、重复 request id、重复文件名和重复版本等非法场景得到稳定错误，而不是静默覆盖。
