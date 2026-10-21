# IdeaStage 部署记录与备份清单（截至 2026-10-21）

本文件保存本次部署会话中需要长期留存的事实、决策、操作结果和备份缺口，作为后续更新的记录入口。`PROGRESS.md` 仅保留当前进度与本文链接。本文不含真实密码或私钥，也不代表已经完成实际数据备份。

## 本窗口哪些内容需要留存

| 类别 | 应保存的内容 | 当前落点与状态 |
|---|---|---|
| 主机与登录资料 | 域名、IP、系统、SSH 用户/端口、私钥位置、登录与指纹核对结果 | 本文下方；私钥正文另行安全备份 |
| 部署账号与目录 | 账号用途、属组、权限、程序与配置位置 | 本文下方；目标机权限最新回执待取得 |
| 技术选择及原因 | MySQL 版本、受限网站账号、外置配置、单进程运行、首次 replay | 本文与正式手册；不依赖聊天重建决策 |
| 操作与验证证据 | 安装/构建结果、用户确认、命令留档、实际部署版本 | 本文记录结果；命令见手册和凭据说明；服务器 Git HEAD 已于 2026-10-21 由用户在 SSH 终端核对 |
| 操作纪律与下一步 | 解释后执行、记录与备份规则、未完成项 | `docs/agents/production-deployment-discipline.md` 与本文 |
| 真实凭据与业务数据 | SSH 私钥、root 密码、运行/维护配置、备份密钥、数据库 | 见下方备份清单；不把真实值抄入本文 |

## 基础设施与访问

- 域名：`ideastage.top`；服务器公网 IPv4：`101.33.79.30`。
- 目标系统：Ubuntu Server 24.04 LTS 64 位；此前用户反馈系统为 24.04.4 LTS，更新重启后内核为 `6.8.0-147-generic`。这里保存会话确认结果，不代表本轮重新探测。
- SSH 用户：`ubuntu`；按此前配置使用 22 端口，密钥登录已成功。用户已核对腾讯云终端与本地主机指纹一致；指纹具体值未在可用文本中记录，日后需要时从可信云控制台复核，不凭空补写。
- SSH 私钥由用户保存于 Windows `C:\Users\Administrator\Downloads\TheFirst.pem`；未读取正文，未核验第二份安全副本。
- 用户确认云防火墙开启四条规则；此前选择为 SSH 22、HTTP 80、HTTPS 443、Ping，实际规则仍以控制台为准。用户因代理出口 IP 变化，选择不限制 22 的固定来源 IP。
- 软件已按会话反馈安装：Node.js 24、Git、nginx、OpenSSL、Certbot、MySQL Community Server 9.7.4。MySQL 已确认运行并监听 `127.0.0.1:3306`；网站端口与数据库不对公网开放。
- 云实例最终地域以控制台为准；活动手册标题中的“香港”和旧交接中的地域不作为实机证明。

## 账号、目录与权限

| 对象 | 已记录配置 | 为什么这样做/证据边界 |
|---|---|---|
| Linux 网站账号 `ideastage` | UID/GID 112，同名组，home `/srv/ideastage`，shell `/usr/sbin/nologin` | 网站独立运行，减少权限；此前已核验 |
| 部署账号 `ubuntu` | 已加入 `ideastage` 与 `ideastage-backup` 组 | 便于部署和读取加密备份；不是网站数据库账号 |
| `/srv/ideastage` 与 `releases` | `root:root`，0755 | 管理发行目录；此前已核验 |
| `/etc/ideastage` | `root:root`，0700 | 保存受限外置配置；此前已核验 |
| `/var/backups/ideastage` | `root:ideastage-backup`，0750 | 让备份组读取加密包；目录存在不等于已有备份 |
| 发行代码目录 | 已给出收口为 `root:ideastage`、移除组写及其他用户权限的命令 | 用户反馈无输出/无报错，尚未取得最新权限回执 |
| 发行目录 `.next/cache` | 已给出归 `ideastage:ideastage`、0700 的命令 | 只给网站缓存写权限；同上 |
| `runtime.env` 与 `maintenance.env` | 计划均为 `/etc/ideastage/` 下 root 管理的 0600 文件 | `runtime.env` 权限及三项随机值已只读核验；用户确认 `maintenance.env` 权限为 0600、`MYSQL_ADMIN_USER=ideastage_bootstrap` 且管理员密码为有效 64 位十六进制值；引导密码已保存至 KeePassXC 并验证可读，迁移字段仍是模板值 |

## 部署选择与已做验证

- 以成功上线为目标，允许调整项目或数据库。用户举例 MySQL 8.0 不构成版本指定。选择 9.7 LTS 是为对齐目标机已安装补丁版和本机已验证系列；生产门禁使用 `MYSQL_REQUIRED_VERSION=9.7`，详见 v1.42 #03 工单。
- 网站计划用专用 MySQL 账号 `ideastage_app`，维护操作用独立凭据；这样网站无需 root/建表权限。Linux 的 `ideastage` 与 MySQL 的 `ideastage_app` 是不同系统里的账号。云端专用数据库账号尚未确认创建。
- 使用单个 Next.js 进程；先以 replay 验证网站与持久化，再显式配置 live，避免把固定回放当成真实模型。计划和配置不等于服务已经启动。
- 服务器 `npm ci --include=dev` 安装完成，输出为 445 个包，出现开发依赖告警和安装脚本警告；不执行强制自动升级。此前本机生产 audit 与完整 audit 边界见生产验证文档。
- 用户贴出的 `env NODE_ENV=production AI_MODE=replay NEXT_TELEMETRY_DISABLED=1 npm run build` 输出：Next.js 16.3.8，编译、TypeScript、页面收集与 16/16 静态页生成均成功。这证明构建通过，不证明网站可访问、数据库或 HTTPS 已就绪。
- 目标机 SSH 终端于 2026-10-21 通过 `sudo mysql -u root -p -NBe 'SELECT VERSION();'` 返回 `9.7.4`，证明目标机实际版本属于选定的 9.7 LTS 系列。无密码方式 `sudo mysql -NBe 'SELECT VERSION();'` 返回 1045，后续 MySQL root 连接须提供密码。目标机真实初始化、生产检查及备份恢复仍待执行。
- 本机 MySQL 9.7.2 的初始化 8/8、生产准备 60/60、备份工具 51/51 及类型/构建验证此前通过；证据入口见工单和验证文档。

### 发行目录与真实提交核对结果

用户构建输出中的目录是 `/srv/ideastage/releases/77c7678a6ad1d6a9bc02389bfc08ba465b6345`。

2026-10-21 用户在 SSH 终端从 `/home/ubuntu` 运行 `sudo git -C /srv/ideastage/releases/77c7678a6ad1d6a9bc02389bfc08ba465b6345 rev-parse HEAD`，实际 HEAD 为 `77c76768a6ad1d6a9bcc02389bfc08ba465b6345`，与本地已核验的 `77c7676` 完整提交一致。发行目录名自身有字符差异，但 Git 仓库 HEAD 已确认；无需改名或覆盖目录。

本地相关历史：`700152a` 为数据库适配，`77c7676` 为部署账号/数据库记录，`0b3592a` 为凭据说明，`ca80d72` 为部署纪律与入口。后两项本会话未推送，服务器未证实包含这些新增文档。完整变更以 Git 为准。

## 真正需要备份的文件与数据

| 重要内容 | 原件/计划位置 | 当前状态 | 还要做什么 |
|---|---|---|---|
| SSH 私钥 | Windows `TheFirst.pem`，路径见上文 | 原件位置由用户确认；第二份副本未核验 | 在用户控制的另一个安全位置保存副本，确保仍能使用 |
| MySQL root 密码 | 用户自行设置 | 值未知，是否另存未确认 | 用户存入个人密码管理器等安全位置；无需提供给 Agent |
| 网站登录密钥、应用数据库密码、邀请码 | `/etc/ideastage/runtime.env` | 2026-10-21 用户确认生成命令成功；随后只读检查确认文件权限为 0600，三个字段均为 64 位十六进制值，未显示真实内容 | 用户已将三项值保存进本地 KeePassXC 保险箱，并确认关闭后重新打开仍可读取；数据库初始化前置的运行凭据副本已完成 |
| 引导/迁移账号凭据 | `/etc/ideastage/maintenance.env` | 模板安装无报错；真实填写未确认 | 填写后另存安全副本；引导账号删除后同步清除失效秘密 |
| 备份解密密钥 | 计划 `/etc/ideastage/backup.key` | 尚未确认生成 | 生成后独立保存服务器之外的副本，与加密包分开保管 |
| 云端业务数据库 | 计划数据库 `ideastage` | 尚未初始化，没有已验收的业务数据库备份 | 初始化后导出加密，实际下载并在隔离库恢复验证 |
| 本机唯一测试账号相关数据 | 本机开发 MySQL，用户称有迁移价值 | 本轮没有迁移、删除或备份证明；不能写成“无价值数据” | 本机删除/重装/迁移前核对并备份；当前路线为云端新库，不自动导入 |
| 已部署源码、锁文件与版本依据 | Git + 目标机发行目录 | 发行目录内 Git HEAD 已与本地记录的完整提交一致；较新的部署文档仅在本地仓库，服务器发行版未证明包含它们 | 保留准确版本和可恢复源码；新文档尚未取得服务器副本证明 |
| nginx/systemd/域名等实际配置 | 项目有模板，目标机应用尚未验收 | 模板不是实际生效配置 | 配置生效后记录实际版本，变更后的文件加入安全副本 |
| 部署文档与操作记录 | 项目 `docs/` 和 Git | 已有本地文件与提交；本次尚无独立远端副本证明 | 按授权推送或另做项目资料副本；临时交接不能作为唯一长期资料 |

完整备份工具当前打包数据库、`runtime.env`、源码与元数据；维护配置、SSH 私钥、root 密码、MySQL 系统账号和备份密钥不在包内。具体字段和私下找回入口以 [凭据说明](deployment-credentials-guide.md) 为准。

**截至 2026-10-21，用户已在 Windows 安装 KeePassXC 2.7.12，创建本地保险箱并确认测试记录保存后可关闭、重新打开。** 用户确认服务器生成命令成功，后续只读检查确认三个运行凭据均已写入 `/etc/ideastage/runtime.env` 且权限为 0600；用户随后将三项值录入 KeePassXC，并确认关闭后重开仍可读取，运行凭据已有服务器外的可读副本。用户也未完成实际复制私钥、保存 root 密码、导出数据库或下载配置备份。文档写好、Git 提交、服务器文件留存、异地副本和恢复通过，是不同的完成状态。

## 长期文档与下一步

- 执行纪律：[上线部署纪律](agents/production-deployment-discipline.md)；项目总入口：根目录 `AGENTS.md`。
- 命令与发布验收：[正式部署手册](deploy-ubuntu-production.md)；随机值原命令与用途：[凭据说明](deployment-credentials-guide.md)。
- 当前任务：`.scratch/pm-assistant-v1.42/issues/03-mysql-97-lts-patch-compatibility.md`；本机生产证据：`docs/verification/v142-production-preparation.md`。
- 临时交接：`C:\Users\Administrator\AppData\Local\Temp\IdeaStage-deployment-handoff-2026-10-21.md`，供换窗口使用。长期事实与清单以项目中的本文及上述专题文件为准。

已核对目标机发行目录内的 Git HEAD；MySQL `SELECT VERSION()` 实测为 9.7.4，管理员密码登录成功，无密码登录失败。runtime.env 三个运行凭据已生成、权限 0600，并在 KeePassXC 验证可读。maintenance.env 中 `ideastage_bootstrap` 管理员用户名/密码已回读验证，权限为 0600；引导密码也已保存至 KeePassXC 并验证可读，迁移字段仍为模板值。下一步创建受限引导账号、初始化全新云库及生产检查；备份恢复、DNS/HTTPS、systemd、真实 AI 与 Cloudflare 均待验收。后续在本文追加日期、变化、证据与备份结果，`PROGRESS.md` 只更新短进度和入口。
