# 01 — 项目脚手架 + 用户认证

**What to build:** 用户可以用邮箱和密码注册、登录、登出。项目从零搭建，MongoDB 连接就绪，注册页和登录页可访问。

**Blocked by:** None — 可立即开始。

**Status:** resolved

- [x] `npm create next-app` 初始化 Next.js 14+ App Router 项目，TypeScript + Tailwind CSS
- [x] 安装依赖：mongoose, next-auth, bcryptjs（跳过了 @auth/mongodb-adapter：Credentials + JWT 策略不需要 DB adapter）
- [x] MongoDB 连接配置（环境变量 `MONGODB_URI`）
- [x] NextAuth.js 配置：Credentials Provider（邮箱 + 密码），JWT session
- [x] User model（mongoose schema）：email, password_hash, created_at
- [x] 注册 API Route：`POST /api/auth/register` — 校验邮箱格式 + 密码长度 ≥6，bcrypt 哈希，写库，返回 201
- [x] 注册页 UI：邮箱输入框、密码输入框、确认密码、注册按钮。表单校验 + 错误提示
- [x] 登录页 UI：邮箱输入框、密码输入框、登录按钮。登录成功跳转项目列表
- [x] 登录后 navbar 显示用户邮箱 + 退出按钮
- [x] 空项目列表页（仅展示"创建第一个项目"引导，项目列表功能留到 Ticket 2）
- [x] 鉴权中间件：未登录用户访问任何受保护路由 → 跳转登录页

## Comments

完成日期：2026-08-05

实现决策：
- 使用 Next.js 16.3.0（符合 spec 的 "14+" 要求）
- 使用 Tailwind CSS v4（create-next-app 默认版本）
- NextAuth.js v5 beta (v5.0.0-beta.32)，配置 Credentials Provider + JWT session
- 跳过了 `@auth/mongodb-adapter`：Credentials + JWT 策略直接查询 MongoDB，不需要 adapter
- 使用 Next.js 16 的 `proxy.ts` 替代旧的 `middleware.ts`（middleware 在 v16 中已废弃）
- 项目从零脚手架搭建（之前目录只有文档和 spec 文件）
