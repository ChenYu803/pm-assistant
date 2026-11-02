# PM Assistant Demo 上线剧本

这不是一份让你学习编程的教程，而是一份“你和 Agent 分工完成上线”的清单。

> **路线状态：海外临时 Demo 草案。** 用户绝大多数在中国大陆后，不应默认按本文创建 Render 服务。优先评估阿里云中国内地应用服务 + 同地域 MySQL，并先确认 ICP 备案和平台限制。Render 方案只适用于接受大陆访问不稳定的海外/内部试用。背景与取舍见 [`china-mainland-deployment-research.md`](china-mainland-deployment-research.md)。

## 你最终会得到什么

一个可以从浏览器打开的 Demo：用户可以注册、登录、创建项目、使用四环工作台，并在需要时调用真实 AI。

第一版建议先使用 Render 提供的网站地址，例如 `https://pm-assistant.onrender.com`。自定义域名和 Cloudflare 放到网站稳定之后再做。

## 先理解三个词

- **网站服务器**：运行页面和后端程序的电脑。这里先用 Render。
- **数据库**：保存账号、项目、聊天和文件的仓库。这里使用一项支持标准 MySQL 协议的云数据库。
- **密钥**：登录签名、数据库密码、AI 密钥。它们只能填在平台的“环境变量”里，不能写进代码或发到聊天中。

## 分工总表

| 阶段 | Agent 负责 | 你负责 | 完成标志 |
|---|---|---|---|
| 1. 改造代码 | 让数据库版本、TLS、连接数和迁移方式适合云端 | 不需要操作 | 本地检查通过 |
| 2. 准备账号 | 告诉你需要哪些值、检查你提供的结果 | 注册 Render、云数据库和 GitHub | 能拿到服务地址和数据库连接信息 |
| 3. 准备数据库 | 提供命令并解释结果 | 在自己的电脑或数据库控制台运行一次迁移 | `db:migrate` 成功 |
| 4. 部署网站 | 检查构建、启动配置和环境变量清单 | 在 Render 点击连接仓库、填写变量、点击部署 | Render 显示 Live |
| 5. 验收 | 给出测试顺序、分析错误日志 | 用浏览器注册测试账号并走核心流程 | 首页、登录、项目、文件和聊天可用 |
| 6. 开真实 AI | 检查超时、费用和失败降级 | 决定是否购买/启用 AI Key | 真实 AI 对话成功且费用可控 |

## 阶段 0：我会先做的代码准备

这是 Agent 的工作，你不需要理解代码细节。目标是让云端环境不被本机条件绑死。

我会完成并验证：

1. 数据库版本改为可配置，不再固定要求 MySQL 9.7.2。
2. 支持云数据库要求的 TLS 证书验证。
3. 连接池大小可配置，避免免费数据库被过多连接压垮。
4. 增加 `npm run db:migrate`：只执行数据库表结构迁移，不在网站运行时创建管理员账号。
5. 保留 `npm run db:init` 给本机或拥有管理员权限的数据库使用。
6. 保持第一次上线使用 `AI_MODE=replay`，不产生 AI 费用。

完成后，我会告诉你测试结果和仍需你决定的事项。

## 阶段 1：你需要准备的三个账号

### GitHub

代码必须在 GitHub 仓库里，因为 Render 会从 GitHub 拉取代码。你需要确认：

- 仓库是你自己的，或你有管理员权限；
- `.env.local` 没有被提交；
- 你知道准备部署的分支名称。

### Render

Render 是暂时承载网站的服务。免费方案适合 Demo，但长时间没人访问时会休眠，第一次打开可能需要等待几十秒。

### 云 MySQL

选择能提供以下信息的服务即可：

- MySQL 主机名、端口、数据库名；
- 应用账号和密码；
- 允许你的电脑和 Render 访问；
- 如果强制加密，能提供 CA 证书文本；
- 支持创建表和修改表结构。

不必寻找“必须是 9.7.2”的服务。现在代码会根据你实际选择的 MySQL 版本进行检查。优先选 MySQL 8.0/8.4 或供应商明确支持的 MySQL 版本；不要选 MariaDB，除非我先完成兼容改造。

## 阶段 2：你把这些信息交给我

你不需要把密码发到聊天里。只需要告诉我“已准备好”，并在本机按我给出的命令运行；命令输出中不要包含密码。

需要的非秘密信息：

```text
MYSQL_HOST=数据库主机
MYSQL_PORT=数据库端口
MYSQL_DATABASE=数据库名
MYSQL_REQUIRED_VERSION=数据库主版本，例如 8
```

需要你自己保管的秘密：

```text
MYSQL_USER=应用账号
MYSQL_PASSWORD=应用账号密码
MYSQL_MIGRATION_USER=一次性迁移账号
MYSQL_MIGRATION_PASSWORD=一次性迁移密码
MYSQL_SSL_CA=供应商 CA 证书（如果需要）
AUTH_SECRET=网站登录签名密钥
AI_API_KEY=真实 AI 密钥（最后才需要）
```

网站运行只需要应用账号，不需要 `MYSQL_ADMIN_USER`、`MYSQL_ADMIN_PASSWORD` 或迁移账号。管理员/迁移账号只用于一次性准备数据库，完成后不放入 Render。

## 阶段 3：一次性准备数据库

根据云数据库供应商的说明创建一个空数据库、一个网站应用账号，以及一个临时迁移账号。迁移账号需要“建表/改表”权限，网站应用账号只需要日常读写权限。然后我会给你一条适合你环境的命令，运行：

```powershell
npm run db:migrate
```

这个命令只做三件事：连接数据库、创建/更新项目所需的表、验证连接。它不会创建网站，也不会调用 AI。迁移账号完成任务后可以删除或撤销权限。

如果供应商允许管理员操作，也可以使用：

```powershell
npm run db:init
```

但这个命令只在你明确知道管理员账号权限时使用。管理员密码绝不填入 Render 的网站环境变量。

## 阶段 4：创建 Render 网站

你在 Render 控制台完成这些点击：

1. 登录 Render。
2. 选择 **New → Blueprint**。
3. 连接 GitHub 仓库和部署分支。
4. 确认区域先选 Singapore，方案先选 Free。
5. 确认构建命令是 `npm ci && npm run build`。
6. 确认启动命令是 `npm run start`。
7. 先不要打开真实 AI。

仓库里的 `render.yaml` 会帮助 Render 填入基础设置。它不是魔法按钮，也不会替你创建数据库。

## 阶段 5：在 Render 填写网站变量

在 Render 的 **Environment** 页面填写：

```text
MYSQL_HOST
MYSQL_PORT
MYSQL_DATABASE
MYSQL_USER
MYSQL_PASSWORD
MYSQL_REQUIRED_VERSION
MYSQL_CONNECTION_LIMIT=3
MYSQL_SSL=true 或 false
MYSQL_SSL_CA=如果供应商要求则填写
AUTH_URL=https://Render给你的地址
AUTH_TRUST_HOST=true
AI_MODE=replay
```

不要填写：

```text
MYSQL_ADMIN_USER
MYSQL_ADMIN_PASSWORD
MYSQL_MIGRATION_USER
MYSQL_MIGRATION_PASSWORD
```

`AUTH_SECRET` 由 Render 自动生成。不要把本机 `.env.local` 的旧密钥复制上去。

## 阶段 6：第一次上线验收

部署显示成功后，你和我按以下顺序检查：

1. 首页能打开。
2. 注册测试账号。
3. 退出后重新登录。
4. 创建项目和工作记录。
5. 打开一个需求分析标签页，发送一条消息。
6. 确认回复能显示，文件能保存，刷新后内容仍在。
7. 检查 Render 日志中没有 `UntrustedHost`、数据库连接错误或启动崩溃。

这一步使用 `replay`，所以聊天内容是预设回放，不是真实 AI。它的意义是先证明网站和数据库真的能工作。

## 阶段 7：决定是否开启真实 AI

只有阶段 6 全部通过后，才考虑：

1. 创建一枚新的 AI API Key，不复用曾经出现在本机文件或聊天里的旧 Key。
2. 在 Render 添加 `AI_API_KEY`。
3. 将 `AI_MODE` 改为 `live`。
4. 用一个测试账号发送一条短消息。
5. 检查响应速度、错误提示和 API 费用。

如果真实 AI 不稳定，可以立刻改回 `replay`，网站仍然可以展示和测试。

## 阶段 8：自定义域名（可选）

Render 地址稳定后再接域名。Cloudflare 第一次配置时选择 **DNS only（灰云）**，先不要代理动态接口。等登录、聊天和文件流程稳定后，再单独评估代理、缓存和中国大陆访问效果。

## 出现问题时怎么处理

- **构建失败**：把 Render 的错误日志发给我，我修代码或配置。
- **数据库连接失败**：只发主机、端口、版本和错误类型，不要发密码。
- **登录失败**：先检查 `AUTH_URL` 是否是完整网站地址、`AUTH_TRUST_HOST=true` 是否存在。
- **聊天超时**：先确认是否仍在 `replay`，再检查平台时长限制和真实 AI 配置。
- **中国大陆访问慢**：这通常是跨境网络或平台位置问题，不代表代码一定有错；先保证海外 Demo 可用，再决定国内承载方案。

## 这几个辅助文件到底是什么

- `render.yaml`：给 Render 看的“部署设置表”，减少手动填写。
- `.node-version`：告诉平台使用哪一代 Node.js。
- `docs/deploy-demo.md`：就是这份说明，供你和 Agent 对照执行。
- `scripts/deploy-demo-wizard.sh`：可选的交互式向导。它只帮你收集变量和打开控制台，不会自动替你创建账号，也不会上传密钥。你完全可以不用它。
