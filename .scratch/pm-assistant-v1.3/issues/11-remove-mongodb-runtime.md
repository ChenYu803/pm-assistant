# 11: 移除 MongoDB 生产运行依赖

**Parent:** #07 — MySQL 单库收口与综合验收

**What to build:** PM Assistant 的生产应用、配置和依赖只保留 MySQL；MongoDB 可以继续安装在用户电脑上，但网站启动、请求处理和构建不再加载或要求 Mongoose/MongoDB。

**Blocked by:** #09 — 对话与工作区 MySQL-only 收口；#10 — 项目成果 API MySQL-only 收口

**Status:** ready-for-agent

- [ ] 静态审计覆盖生产源码、配置和依赖清单；所有仍可执行的 MongoDB/Mongoose 导入都有 MySQL 等价实现后再移除。
- [ ] 删除旧 MongoDB 连接、模型、ownership、并发、冻结、删除和上下文运行模块，不留下通过动态导入或异常分支才能触发的回退。
- [ ] 移除应用配置中的 MongoDB 连接要求和包依赖，更新锁文件；MySQL 配置缺失时只报告 MySQL 环境错误。
- [ ] 客户端注释、共享类型和服务端错误文案不再把 ObjectId/MongoDB 描述成当前契约。
- [ ] 空 MySQL 环境仍直接进入正常注册流程；不实现双写、数据回搬或切回 MongoDB。
- [ ] 类型检查、构建和静态依赖检查证明生产代码不再引用 MongoDB/Mongoose，同时不删除仍待 #12 迁移的验证资产。

## 相关 spec

见 v1.3 spec 的“应用数据库”“旧数据”“用户界面”和“Out of Scope”。
