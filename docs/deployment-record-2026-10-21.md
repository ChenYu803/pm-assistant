# IdeaStage 部署记录与备份清单（基础记录截至 2026-10-21，状态更新至 2026-11-06）

## 2026-11-06 v1.44 #15 历史模型费用反馈补充

用户确认IdeaStage API仅2026-11-03有调用、历史累计费用小于0.01元，其余日期无调用。以用户人工核对为来源，历史总额计提0.01 CNY，200 CNY预算保守可规划余额199.99 CNY；未独立查看账单，不宣称精确余额。旧样本5笔逐笔待确认费用已包含在总额计提中，仍保留未知状态与停止计费能力限制。详见[更新后的预检记录](verification/v144-live-acceptance-preflight-20261106.md)。本次未发生生产连接、付费调用、配置修改或开放；前一预检段中的历史费用阻断已由本补充更新，其余发布条件仍待验证。

## 2026-11-06 v1.44 #15 目标环境真实能力预检

#14 已交付“受控验收就绪”，但 #15 尚未满足正式开放条件。只读汇总见[预检记录](verification/v144-live-acceptance-preflight-20261106.md)和[预检台账](verification/v144-live-acceptance-preflight-20261106.json)。当前目标机仍保持受限入口：服务与恢复 timer 正常，回环健康可用，公网与源站返回 403；未执行新增付费模型请求、真实密码找回、资金操作、push或解除限制。

可定位的历史本机官方样本为8次请求、0.000127 CNY已确认、5笔待确认，无法代表开发至首批试用的完整累计支出，因而不能计算可信的200 CNY剩余额度。正式推进前须由受限配置补齐历史账单、待确认成本处理、供应商余额/账单、邮件服务及发信身份、可收信邮箱、目标应用逐笔账本、停止计费能力和运营联系方式；密钥不写入本文或Git。
## 2026-11-04 v1.44 #14 升级准备（尚未切换）

目标机/远端HEAD均77c7676，精确候选a209313已在独立releases目录构建、tsc及权限收口；current仍旧版，正式库22迁移、空业务。新加密备份/系统维护配置包已下载至D:/Backups/IdeaStage/v144-upgrade-20261104，用独立目录下本机密钥实际解密；本机随机库恢复22表/22迁移后清理，没有旧账号/正文可验。

真实RESEND_API_KEY和EMAIL_FROM缺失导致候选启动预检失败；未迁移/切换/启用timer，旧站active、health200。旧维护管理员凭据失效、迁移账号可连接。完整哈希、保存位置、失败专项及受控切换/资金兼容恢复方案见[本次记录](verification/v144-production-upgrade.md)与[执行单](v144-production-upgrade-runbook.md)。本段为当前状态，下文历史事实按各自日期理解。

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

## 2026-11-02 邮件配置只读核实

- 用当前记录的 D:/SSH_pem/IdeaStage_SSH_2026.pem 对既有主机只读检查 runtime.env，权限仍为0600。Resend/SMTP/SES/Postmark/SendGrid相关字段均未配置；未显示真实值、未修改服务器、未发真实邮件。
- 本地旧 SSH 别名和凭据说明的 Downloads/TheFirst.pem 已不存在，当前密钥入口以本记录为准。
- v1.44 #02 提供邮箱认证实现与Resend适配，但真实发信身份、域名/凭据、注册/找回收件证据尚缺。生产准备需补邮件配置并刷新安全副本，见 [邮箱认证验收](verification/v144-email-auth.md)。

## 2026-11-04 本机个人中心数据库迁移

- 用户确认修复目标为本机 `127.0.0.1:3306/pm_assistant`，不是线上服务器。MySQL 为 9.7.2；迁移前最新记录为 `0022_v142_ai_daily_usage`，个人中心报错对应 `users.account_status` 列缺失。
- 迁移前备份位于 `D:\Backups\IdeaStage\pm_assistant-local-before-profile-migration-20261104\pm_assistant.sql`，大小 1,510,637 bytes，SHA-256 `f83b978df9b74b1f20743e4d94f05bc4d945aff5b0e3c62a440da8200ed549c0`。目录 ACL 仅授予当前 Windows 管理员与 SYSTEM 完全控制。备份通过临时隔离库实际恢复验证：22 张表、328 个账号、309 个项目及 22 条迁移记录；隔离库已删除。应用账号缺少导出所需的 `FLUSH_TABLES` 权限，因此备份由本机维护管理员导出，未修改数据库账号或授权。
- 使用 `src/lib/mysql-bootstrap.ts` 的 `migrateMysql` 迁移入口，以本机维护管理员身份应用 0023–0032 共 10 项；没有运行会重设应用账号密码/授权的 `db:init`。迁移后 32 条迁移均登记，`account_status` 为非空列且默认 `active`；users 仍为 328，projects 仍为 309，`test1@example.com` 记录存在。未修改/清理业务行，未访问生产库。
- 本机 `npm run dev` 已启动于 `http://localhost:3000`。未登录 GET `/profile` 返回 302 并重定向到 `/login?callbackUrl=%2Fprofile`，未复现数据库 500；由于没有用户登录态，仍需用户刷新个人中心确认页面。该记录仅证明本机操作，不代表目标服务器迁移、备份或发布已完成。

## 基础设施与访问

- 域名：`ideastage.top`；服务器公网 IPv4：`101.33.79.30`。
- 目标系统：Ubuntu Server 24.04 LTS 64 位；此前用户反馈系统为 24.04.4 LTS，更新重启后内核为 `6.8.0-147-generic`。这里保存会话确认结果，不代表本轮重新探测。
- SSH 用户：`ubuntu`；按此前配置使用 22 端口，密钥登录已成功。用户已核对腾讯云终端与本地主机指纹一致；指纹具体值未在可用文本中记录，日后需要时从可信云控制台复核，不凭空补写。
- SSH 私钥现由用户保存于 Windows `D:\SSH_pem\IdeaStage_SSH_2026.pem`；2026-10-25 已用该密钥成功登录。未读取正文，未核验第二份安全副本。
- 用户确认云防火墙开启四条规则；此前选择为 SSH 22、HTTP 80、HTTPS 443、Ping，实际规则仍以控制台为准。用户因代理出口 IP 变化，选择不限制 22 的固定来源 IP。
- 软件已按会话反馈安装：Node.js 24、Git、nginx、OpenSSL、Certbot、MySQL Community Server 9.7.4。MySQL 已确认运行并监听 `127.0.0.1:3306`；网站端口与数据库不对公网开放。
- 云实例最终地域以控制台为准；活动手册标题中的“香港”和旧交接中的地域不作为实机证明。

### 2026-10-25 只读状态刷新

- 用户确认当前为腾讯云香港服务器，用于部署 IdeaStage 网站及同机 MySQL；此前 SSH 私钥遗失后，已在腾讯云重新创建并绑定新密钥，Windows 私钥路径为 `D:\SSH_pem\IdeaStage_SSH_2026.pem`，本次 SSH 密钥登录成功。
- 本日稍后签发 HTTPS 证书之前，`systemctl is-active` 实测 `ideastage`、`nginx`、`mysql`、`ideastage-backup.timer` 均为 `active`。`http://127.0.0.1:3000/api/health` 返回 HTTP 200 和 `{"status":"ok"}`；nginx 对 `Host: ideastage.top` 的 HTTP 请求返回 503，符合当时未签发 HTTPS 的引导配置；`nginx -t` 通过。HTTPS 签发后的状态见下方发布记录。
- 备份 timer 于 2026-10-25 03:02（北京时间）成功生成 `2026-10-24T19-02-26-063Z-34ed640a.isb`，大小 6,106,132 bytes，元数据 commit 为 `77c76768a6ad1d6a9bcc02389bfc08ba465b6345`。服务器端配套 SHA-256 校验通过。2026-10-25 12:34（北京时间）已用 `scripts/Pull-IdeaStageBackup.ps1` 拉取到 Windows `D:\Backups\IdeaStage`；本机文件大小 6,106,132 bytes，SHA-256 `05705a9d744ee70e90b827a9ffc832a334085a040e7e1662b2d75fbb447bbd76` 与服务器索引及 `.sha256` 一致，`last-pull.json` 已更新。备份仍为加密包，未解密或恢复；百度网盘副本尚未确认。
- DNS 与权威性：用户已将腾讯云域名 nameserver 改为 Cloudflare 分配值。Cloudflare 权威服务器 `108.162.194.190` 与 Google DNS `8.8.8.8` 均返回 NS `sonia.ns.cloudflare.com` / `wilson.ns.cloudflare.com`；根域 A 返回 `101.33.79.30`。Cloudflare 中 A 记录状态仍为 DNS-only，解析直达源站；Cloudflare 代理/CDN尚未开启。
- 2026-10-25 HTTPS 发布：Certbot 2.9.0 使用 webroot 成功签发 `ideastage.top` Let's Encrypt 证书，有效期至 2027-01-23，注册时未提供提醒邮箱；自动续期 timer 已由 Certbot 配置，因此没有到期邮件提醒。nginx HTTPS 模板与代理 snippet 已安装，`nginx -t` 通过并 reload；HTTP 返回 301 到 HTTPS。公网 DNS 解析路径访问 `https://ideastage.top/api/health` 返回 HTTP 200 `{"status":"ok"}`，TLS 证书链校验通过，响应含 `X-Accel-Buffering: no`。`/etc/letsencrypt/renewal-hooks/deploy/ideastage-nginx` 为 root:root 0755，内容先测 `nginx -t` 再 reload；手动执行成功，`certbot renew --dry-run` 的 staging 续期演练成功。
- Cloudflare 源站准备：从 `https://www.cloudflare.com/ips-v4` 和 `/ips-v6` 读取当前官方网段后，在服务器新增 `/etc/nginx/conf.d/zz-cloudflare-real-ip.conf`，只信任这些 CIDR 的 `CF-Connecting-IP`；实际访客 IP 将用于 nginx 日志和按 IP 限流。nginx real-IP 模块存在，配置测试与 reload 通过。公网直连时附带伪造 `CF-Connecting-IP: 203.0.113.123`，访问日志仍记录实际连接地址 `120.229.205.198`，证明非 Cloudflare 来源不能伪造访客 IP。启用代理后若官方网段变化，须更新配置并 reload。
- 2026-10-25 Cloudflare 代理验证：用户已启用根域 A 记录代理。Cloudflare 权威 DNS `108.162.194.190` 与 Google DNS `8.8.8.8` 均返回边缘 IP `104.21.75.78` / `172.67.217.143`。显式请求边缘 IP 并保留 `ideastage.top` TLS SNI/Host，首页、`/login`、`/api/health` 均返回 200，含 `Server: cloudflare`、`CF-Ray`；API 返回 `Cache-Control: no-store` / `cf-cache-status: DYNAMIC`，首页和登录页 `cf-cache-status: DYNAMIC`，没有从边缘缓存。nginx 日志对应边缘请求记录真实访客 IP `120.229.205.198`，非伪造的 `CF-Connecting-IP`。此证据证明配置路径已代理，不证明该访客 IP 属于用户内陆网络。
- DNS/本机请求路径复核：清除 Windows DNS 缓存后，本机递归 DNS `120.196.165.24` / `192.168.247.6`、Cloudflare 权威 DNS 与 Google DNS 均返回边缘 IP `104.21.75.78` / `172.67.217.143`。正常 `Invoke-WebRequest` 得到 `Server: cloudflare`、`CF-Ray`、health 200 和 `cf-cache-status: DYNAMIC`。此前 `curl --noproxy "*"` 是显式绕过系统代理的直连测试，命中源站且没有 CF-Ray；不能用该命令代表普通浏览器流量。显式指定 Cloudflare 边缘地址的 TLS/HTTP 也通过。
- 下一步：由用户在内陆网络验收登录/持久化及超过 125 秒的 SSE 心跳。Cloudflare API health、首页/登录页基础响应已测，API 为 no-store，抽测页面均为 DYNAMIC；真实长生成、SSE 缓冲、登录数据隔离仍未验收。若启用了自定义缓存规则，确保绕过 `/api/*`、`/login*`、`/register*`、`/projects*`、`/work-records*`，不缓存或转换 SSE。当前外部请求证明代理可工作，但未从 Cloudflare 控制台独立读取 Full (strict) 模式设置。

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
| `runtime.env` 与 `maintenance.env` | `/etc/ideastage/` 下 root 管理的 0600 文件 | `runtime.env` 三个运行凭据已存 KeePassXC 并验证可读。`maintenance.env` 当前使用独立迁移账号，权限 0600；临时引导账号及其密码已删除/清除 |

## 部署选择与已做验证

- 以成功上线为目标，允许调整项目或数据库。用户举例 MySQL 8.0 不构成版本指定。选择 9.7 LTS 是为对齐目标机已安装补丁版和本机已验证系列；生产门禁使用 `MYSQL_REQUIRED_VERSION=9.7`，详见 v1.42 #03 工单。
- 网站使用专用 MySQL 账号 `ideastage_app`，维护迁移使用独立账号 `ideastage_migration`；这样网站无需 root/建表权限。Linux 的 `ideastage` 与 MySQL 的 `ideastage_app` 是不同系统里的账号。
- 使用单个 Next.js 进程；先以 replay 验证网站与持久化，再显式配置 live，避免把固定回放当成真实模型。计划和配置不等于服务已经启动。
- 服务器 `npm ci --include=dev` 安装完成，输出为 445 个包，出现开发依赖告警和安装脚本警告；不执行强制自动升级。此前本机生产 audit 与完整 audit 边界见生产验证文档。
- 用户贴出的 `env NODE_ENV=production AI_MODE=replay NEXT_TELEMETRY_DISABLED=1 npm run build` 输出：Next.js 16.3.8，编译、TypeScript、页面收集与 16/16 静态页生成均成功。这证明构建通过，不证明网站可访问、数据库或 HTTPS 已就绪。
- 目标机 SSH 终端于 2026-10-21 通过密码连接返回 MySQL `9.7.4`；root 密码与用户指定值相同，未执行重复轮换。只读检查发现数据库已有 22 项迁移/22 张表，`ideastage_app` 原先只有无权限的 USAGE，导致应用账号访问被拒；使用 root 将其限定授权为 `ideastage.*` 上 SELECT/INSERT/UPDATE/DELETE 后，生产数据库检查通过。
- 目标机 `production-db.ts --initialize` 幂等初始化通过（新增迁移：否），`production-db.ts` 仅迁移入口和 `production-check.ts --database` 均通过。新建并验证 `ideastage_migration` 的项目库范围结构权限与连接后，已删除临时 `ideastage_bootstrap` 并从 `maintenance.env` 清除其密码；`maintenance.env` 当前仍为 0600。服务器根密码已单独保存到 KeePassXC 条目“MySQL root”，原“MySQL 引导账号”条目保持不变；新的迁移账号条目也已保存。
- 已为 32 字节备份密钥建立 KeePassXC 独立条目，并以 0600 写入 `/etc/ideastage/backup.key`。每日备份 systemd service/timer 已安装并启用；首次服务器加密包于 2026-10-21 生成。Windows 脚本已将备份拉取至 `D:\Backups\IdeaStage`，索引 SHA-256 核验通过；服务器 inspect 解密/完整性检查通过，随机隔离库恢复出 22 张表并核对行数后由工具清理。此恢复验收没有覆盖正式库，也没有证明业务数据已存在；当前 users 为 0。
- 网站 systemd 单实例 service 已安装、设为开机启动并运行；启动前 `production-check.ts --database --recover` 成功。应用仅监听本机 `127.0.0.1:3000`，`http://127.0.0.1:3000/api/health` 返回 200。nginx HTTP 引导配置已安装并通过 `nginx -t`，域名 Host 的 HTTP 返回 503，符合签发证书前不开放登录的模板行为。域名仍无 IPv4 DNS 解析，HTTPS 证书及公网入口尚未验收。
- 本地 KeePassXC 命令行读取密钥后，Windows 临时目录密钥文件的辅助命令被自动审查拦截；随后在服务器使用受限密钥完成 inspect 和隔离恢复，恢复验收通过。Windows 副本通过索引 SHA-256 校验；解密验收使用服务器保存的同一密钥与服务器原包。
- 本机 MySQL 9.7.2 的初始化 8/8、生产准备 60/60、备份工具 51/51 及类型/构建验证此前通过；证据入口见工单和验证文档。

### 发行目录与真实提交核对结果

用户构建输出中的目录是 `/srv/ideastage/releases/77c7678a6ad1d6a9bc02389bfc08ba465b6345`。

2026-10-21 用户在 SSH 终端从 `/home/ubuntu` 运行 `sudo git -C /srv/ideastage/releases/77c7678a6ad1d6a9bc02389bfc08ba465b6345 rev-parse HEAD`，实际 HEAD 为 `77c76768a6ad1d6a9bcc02389bfc08ba465b6345`，与本地已核验的 `77c7676` 完整提交一致。发行目录名自身有字符差异，但 Git 仓库 HEAD 已确认；无需改名或覆盖目录。

本地相关历史：`700152a` 为数据库适配，`77c7676` 为部署账号/数据库记录，`0b3592a` 为凭据说明，`ca80d72` 为部署纪律与入口。后两项本会话未推送，服务器未证实包含这些新增文档。完整变更以 Git 为准。

## 真正需要备份的文件与数据

| 重要内容 | 原件/计划位置 | 当前状态 | 还要做什么 |
|---|---|---|---|
| SSH 私钥 | Windows `TheFirst.pem`，路径见上文 | 原件位置由用户确认；第二份副本未核验 | 在用户控制的另一个安全位置保存副本，确保仍能使用 |
| MySQL root 密码 | KeePassXC “IdeaStage MySQL root” | 当前值已由用户提供并验证可登录；同值已单独写入此条目，私下回读与服务器当前值匹配。由于 root 原本已是用户指定值，没有轮换 | 不用于网站运行；root 丢失时只能重设 |
| 网站登录密钥、应用数据库密码、邀请码 | `/etc/ideastage/runtime.env` | 2026-10-21 用户确认生成命令成功；随后只读检查确认文件权限为 0600，三个字段均为 64 位十六进制值，未显示真实内容 | 用户已将三项值保存进本地 KeePassXC 保险箱，并确认关闭后重新打开仍可读取；数据库初始化前置的运行凭据副本已完成 |
| 引导/迁移账号凭据 | `/etc/ideastage/maintenance.env` | 临时引导账号已删除，密码已从文件清除；迁移账号凭据保存在 KeePassXC 独立条目，服务器文件权限 0600 |
| 备份解密密钥 | `/etc/ideastage/backup.key` | 已生成 32 字节密钥，服务器文件权限 0600；独立 KeePassXC 条目已保存 |
| 云端业务数据库 | MySQL `ideastage` | 已有 22 张表及 22 项迁移，业务 users 为 0；首次加密备份已在本机拉取并通过随机隔离库恢复演练 | 继续保持每日备份，按周及重大更新把加密包另存网盘；目前没有用户业务数据 |
| 本机唯一测试账号相关数据 | 本机开发 MySQL，用户称有迁移价值 | 本轮没有迁移、删除或备份证明；不能写成“无价值数据” | 本机删除/重装/迁移前核对并备份；当前路线为云端新库，不自动导入 |
| 已部署源码、锁文件与版本依据 | Git + 目标机发行目录 | 发行目录内 Git HEAD 已与本地记录的完整提交一致；较新的部署文档仅在本地仓库，服务器发行版未证明包含它们 | 保留准确版本和可恢复源码；新文档尚未取得服务器副本证明 |
| nginx/systemd/域名等实际配置 | systemd 网站及备份 service/timer 已安装；nginx HTTP 引导已安装 | 网站和备份 timer active；nginx 配置检查通过。HTTP 对 `ideastage.top` 返回 503，应用 localhost health 200 | 配置域名 A 记录并签发 HTTPS 证书，再安装 HTTPS nginx 配置，完成公网 health/登录/业务验收 |
| 部署文档与操作记录 | 项目 `docs/` 和 Git | 已有本地文件与提交；本次尚无独立远端副本证明 | 按授权推送或另做项目资料副本；临时交接不能作为唯一长期资料 |

完整备份工具当前打包数据库、`runtime.env`、源码与元数据；维护配置、SSH 私钥、root 密码、MySQL 系统账号和备份密钥不在包内。具体字段和私下找回入口以 [凭据说明](deployment-credentials-guide.md) 为准。

**截至 2026-10-21，用户已在 Windows 安装 KeePassXC 2.7.12，创建本地保险箱并确认可重开。** 运行凭据、root 密码、迁移账号密码和备份解密密钥均有独立保险箱条目；引导账号条目保留为历史凭据记录，但服务器端账号与密码已退役。SSH 私钥第二份副本尚未核验，备份加密包尚未上传百度网盘。文档记录、Git 提交、服务器留存、异地副本和恢复通过仍是不同状态。

## 长期文档与下一步

- 执行纪律：[上线部署纪律](agents/production-deployment-discipline.md)；项目总入口：根目录 `AGENTS.md`。
- 命令与发布验收：[正式部署手册](deploy-ubuntu-production.md)；随机值原命令与用途：[凭据说明](deployment-credentials-guide.md)。
- 当前任务：`.scratch/v1.42/issues/03-mysql-97-lts-patch-compatibility.md`；本机生产证据：`docs/verification/v142-production-preparation.md`。
- 临时交接：`C:\Users\Administrator\AppData\Local\Temp\IdeaStage-deployment-handoff-2026-10-21.md`，供换窗口使用。长期事实与清单以项目中的本文及上述专题文件为准。

已核对目标机发行目录内的 Git HEAD；MySQL `SELECT VERSION()` 实测为 9.7.4。目标库幂等初始化、生产数据库检查、迁移账号连接、每日加密备份、Windows 下载哈希核对、解密检查及随机库恢复均通过；临时引导账号已清理。网站 systemd 单实例已启动，启动前恢复检查成功，本机 health 200；nginx HTTP 引导返回 503。域名 `ideastage.top` 当前无 IPv4 解析，HTTPS、公网登录/业务及真实 AI 尚未验收；异地网盘副本和 SSH 私钥副本仍待用户整理。后续在本文追加日期、变化、证据与备份结果，`PROGRESS.md` 只更新短进度和入口。
