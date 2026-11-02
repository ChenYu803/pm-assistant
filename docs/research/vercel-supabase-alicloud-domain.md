# Vercel + Supabase + 阿里云域名：可行性

调研日期：2026-09-23

## 结论

这套组合**技术上可行**：Vercel 运行 Next.js，Supabase 提供 PostgreSQL 数据库（可选 Supabase Auth），阿里云只负责注册域名；域名解析可以指向 Vercel。购买域名的公司和网站服务器不必是同一家公司。

但它不是把当前应用的数据库地址换一下就能上线：仓库当前直接使用 `mysql2`，SQL 与迁移均面向 MySQL。改用 Supabase Database 意味着将数据层从 MySQL 改为 PostgreSQL，并重写/验证查询、事务、迁移、约束和测试。好消息是用户明确表示数据和规矩可调整，Demo 若没有需保留的线上数据，可以直接以 PostgreSQL 为新起点，不必设计旧 MySQL 数据迁移。

第二个现实问题是 Vercel Hobby 的请求时长。项目当前聊天与润色上游超时配置为 600 秒；Vercel Hobby Functions 官方最大执行时间为 300 秒，即一条可能持续 10 分钟的 SSE 流不适合原样部署到 Hobby。可以改短时限/设计可恢复的后台任务，或选择满足时长要求的付费方案；不能只凭“Vercel 支持 Next.js”忽略这一限制。

大陆访问方面：Vercel Hobby 可将函数配置到一个区域，官方区域列表有香港、东京、新加坡，没有中国大陆。Supabase 数据库也必须选一个实际可用区域；应用函数和数据库应尽量同区或近区。该组合成本有机会较低，但不能承诺大陆所有运营商都稳定；需要从目标用户网络实测。

## 三个服务各做什么

| 服务 | 在方案中的职责 |
|---|---|
| Vercel | 构建、托管并运行 Next.js 页面与 API |
| Supabase | 托管 PostgreSQL；可另外选择使用其 Auth、Storage 等产品，但不是必须全部启用 |
| 阿里云域名 | 注册/持有域名；通过 DNS 记录将域名指向 Vercel。域名注册商不决定应用服务器位置 |

## 当前项目改造量

### 数据库迁移

仓库使用 `mysql2/promise`，MySQL 迁移位于 `src/lib/mysql-bootstrap.ts`，数据层分散于账号/工作区、聊天、并发、消息、文件、冻结和迭代模块。改为 Supabase PostgreSQL 至少需要：

1. 用 PostgreSQL 建表迁移替换 MySQL DDL、枚举、索引、JSON、时间类型和校验逻辑；
2. 将 `?` 占位符、反引号、`INSERT ... ON DUPLICATE KEY UPDATE`、`ResultSetHeader` 等 MySQL 特性逐处改成 PostgreSQL 对应方式；
3. 检查事务和行锁行为；
4. 用一套空 PostgreSQL 数据库完整重跑认证、项目、迭代、聊天 SSE、文件写入、来源记录、删除和并发回放。

`0009_v141_product_iterations_reset` 当前明确是全新模型重置旧业务数据。若尚无要保留的用户/项目数据，可直接以 PostgreSQL 全新 schema 验收；切勿把该迁移跑到含有要保留数据的数据库上。

### 登录

Supabase Auth 是可选的。保留当前 NextAuth + 自建 users 表，会少引入一个身份服务，但仍需把 users 存储和密码流程改为 PostgreSQL。改用 Supabase Auth 则需要调整注册/登录页面、session/JWT 验证、用户 ID 关联及 API 授权边界；不能假设它自动兼容现有 NextAuth。

## 需要在发布前解决的关键点

### Vercel 执行时长

官方 Vercel Functions streaming 文档支持流式响应，但函数最大时长也计算发送 stream 的时间。Hobby 最大 300 秒，当前聊天和润色设置 600 秒。因此选 Hobby 时必须把产品行为改成不依赖单个超过 5 分钟的请求，例如明确较短的生成上限或设计后台任务 + 可恢复状态；另一个选择是符合需求的付费函数计划并在部署后验证。

### 区域和连接方式

Vercel Functions 默认区域需要核实/配置；Hobby 只能选一个区域。香港、东京、新加坡是官方可选地区，但不等于大陆网络保证。Supabase 创建项目时也要选择数据库区域；数据库与应用函数跨区会增加服务端数据库往返。Vercel 的 Supabase 集成文档建议使用适合 serverless 的连接方式/连接池，需按 Supabase 当前连接字符串指南配置。

### 域名与阿里云

阿里云作为注册商不妨碍把域名指向 Vercel。完成注册和实名验证后，在 Vercel 项目添加域名，再按 Vercel 给出的 DNS 记录到阿里云 DNS 控制台配置。根域名和 `www` 可能需要不同记录；以 Vercel Domains 页面给出的记录为准，不照抄过时教程。若之后把 DNS 托管迁到 Cloudflare，那是可选项，和在哪里买域名是两件事。

中国大陆服务器的备案要求与海外托管不同。Vercel/Supabase 海外托管不应仅凭域名在阿里云购买就推断必须或不需要备案；要按实际服务器/加速服务、主体和业务核实主管要求。阿里云域名注册的实名和具体后缀限制也要在下单时确认。

## 可比较的两条实现路线

| 路线 | 好处 | 代价/风险 | 对当前 Demo 的粗略评价 |
|---|---|---|---|
| **Vercel + Supabase PostgreSQL + 阿里云域名** | 常见 Next.js 组合；数据库区域可配置；平台集成丰富 | MySQL → PostgreSQL 是实质性数据层改造；Hobby 300 秒限制与当前 600 秒生成不符；大陆网络仍需实测 | 如果愿意改数据库和 AI 请求架构，是可行候选；不是当天零改造上线 |
| **Vercel + 保留阿里云 MySQL + 阿里云域名** | 暂时少做 DB 迁移 | Vercel 到 MySQL 公网/TLS/白名单；serverless 连接数；Hobby 长请求限制仍在；Supabase 在此路线里可不使用 | 不是 “Vercel+Supabase”；若重视保留现有 MySQL，要单独比较 Render/VPS |

## 推荐判断顺序

1. 先确认域名后缀和是否已有数据/账号需要保留。
2. 以“低成本获得第一位大陆用户”为目标，评估完整链路，而不是选平台名气：注册、登录、项目创建、文件保存、刷新读取、SSE 聊天。
3. 若选 Vercel + Supabase，正式立项为 MySQL → PostgreSQL 改造，并决定 Auth 保留 NextAuth 还是迁 Supabase Auth。
4. 若使用 Vercel Hobby，先解决 600 秒请求不适配问题，再部署；不要等上线后才发现流被平台终止。
5. 建好 Vercel + Supabase 后，拿真实大陆移动网络、电信/联通/校园网各测一次；结果够用就先找用户，不够再比较香港/内地或其他线路。

## 官方来源

- [Vercel Next.js](https://vercel.com/docs/frameworks/nextjs)：Next.js 部署支持。
- [Vercel Functions regions](https://vercel.com/docs/functions/configuring-functions/region)：函数区域配置。
- [Vercel available regions](https://vercel.com/docs/regions)：区域列表及计划边界。
- [Vercel streaming functions](https://vercel.com/docs/functions/streaming-functions)：流式响应。
- [Vercel function duration limits](https://vercel.com/docs/functions/limitations)：函数运行时限，随计划不同。
- [Supabase database regions](https://supabase.com/docs/guides/platform/regions)：项目数据库区域及区域选择说明。
- [Supabase with Vercel](https://supabase.com/docs/guides/hosting/vercel)：Vercel 集成指南。
- [Supabase connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)：Direct、Session pooler、Transaction pooler 连接方式。
- [Supabase Auth](https://supabase.com/docs/guides/auth)：Auth 为 Supabase 平台能力；是否采用需单独决定。
- [Vercel external DNS](https://vercel.com/docs/domains/working-with-dns)：外部注册商域名配置。
- [阿里云 ICP 备案说明](https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/what-is-an-icp-filing)：备案与内地服务器的关系；具体业务仍需核实。

本文是技术选型说明，不构成价格承诺或法律意见。最终订阅价格、免费额度、区域供应和域名实名/备案条件应在开户时以供应商控制台为准。
