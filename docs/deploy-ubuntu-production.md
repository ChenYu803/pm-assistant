# IdeaStage v1.42：香港 Ubuntu 单机部署与恢复

当前路线：Ubuntu 24.04 x64、Node.js 24 LTS、MySQL 9.7.2、nginx、一个 Next.js 进程，域名 `ideastage.top`。配置和工具已在仓库准备；服务器、Linux 服务加载、证书、Cloudflare 和真实模型尚未验收。本文替代旧 Render/美国 VPS 示例作为本次部署入口，不迁移本机开发数据。

## 1. 开始前拿到的信息

- 服务器公网 IP、SSH 用户/端口及核对过的主机密钥；保留商家控制台救援入口。
- 仓库拉取权限和要部署的完整 commit SHA；未提交的本机代码不能当作发行版本。
- 域名控制台权限；首次只解析 `ideastage.top` 的 A 到实际 IPv4。未启用 IPv6 不加 AAAA；无需先开 Cloudflare 橙云。
- 首次生产配置：独立随机 AUTH_SECRET、应用数据库密码、邀请码；启用 live 时再配置供应商 key。不要把值发到日志、截图、Git 或聊天。

SSH 登录后先核对系统、磁盘挂载、剩余空间、时区与公网连通性。100 人在线只是预期，本轮没有容量证明。安全组/防火墙仅开放实际 SSH 端口与 80/443，3306/3000 不对公网开放。MySQL 监听 127.0.0.1，确认重启后数据目录仍在持久磁盘。

安装 Node.js 24 LTS、Git、nginx、tar、OpenSSL、certbot 和 **MySQL 官方仓库的 9.7.2** 服务端/客户端。不要把 Ubuntu 默认 MySQL 当成同一版本；APT 源和签名按官方当日说明配置，先用 `apt-cache policy mysql-community-server` 确认可选版本。版本升级另做验证，不在上线时顺带升级。

```bash
node --version
npm --version
mysql --version
mysqldump --version
nginx -v
sudo mysql -e 'SELECT VERSION();'
```

Node 应为 24.x，数据库实际版本为 9.7.2。服务模板使用 `/usr/bin/node`，若 `command -v node` 不同，修改两个 service 的绝对路径；不要依赖 nvm 的交互 shell。软件获取依据见 [上线核查](research/launch-prerequisites-2026-10-17.md)。

## 2. 目录、发行版与外置配置

以下 Linux 命令由有 sudo 权限的部署账号执行。`REPOSITORY_URL`、`RELEASE_SHA`、`SSH_USER` 是部署时填入的值，不是可直接照抄的凭据。

```bash
sudo adduser --system --group --home /srv/ideastage ideastage
sudo groupadd -f ideastage-backup
sudo chown root:root /srv/ideastage
sudo chmod 0755 /srv/ideastage
sudo install -d -o root -g root -m 0755 /srv/ideastage/releases
sudo install -d -o root -g root -m 0700 /etc/ideastage
sudo install -d -o root -g ideastage-backup -m 0750 /var/backups/ideastage
sudo usermod -aG ideastage-backup SSH_USER
sudo usermod -aG ideastage SSH_USER
```

备份组成员仅能读取加密包与索引，不能读取 `/etc/ideastage/backup.key`。重新登录 SSH 后组权限才生效。仓库只使用外置环境文件，发行目录不能有 `.env*`（`.env.example` 模板除外）。

```bash
RELEASE_SHA=填写完整提交SHA
REPOSITORY_URL=填写仓库SSH或HTTPS地址
sudo install -d -o SSH_USER -g ideastage -m 0750 "/srv/ideastage/releases/$RELEASE_SHA"
git clone "$REPOSITORY_URL" "/srv/ideastage/releases/$RELEASE_SHA"
cd "/srv/ideastage/releases/$RELEASE_SHA"
git checkout --detach "$RELEASE_SHA"
npm ci --include=dev
env NODE_ENV=production AI_MODE=replay NEXT_TELEMETRY_DISABLED=1 npm run build
sudo chown -R root:ideastage "/srv/ideastage/releases/$RELEASE_SHA"
sudo chmod -R g-w,o-rwx "/srv/ideastage/releases/$RELEASE_SHA"
sudo install -d -o ideastage -g ideastage -m 0700 .next/cache
sudo chown -R ideastage:ideastage .next/cache
sudo install -o root -g root -m 0600 deploy/ubuntu/runtime.env.example /etc/ideastage/runtime.env
sudo install -o root -g root -m 0600 deploy/ubuntu/maintenance.env.example /etc/ideastage/maintenance.env
sudoedit /etc/ideastage/runtime.env
sudoedit /etc/ideastage/maintenance.env
sudo node --import tsx scripts/production-check.ts --env /etc/ideastage/runtime.env
```

如果仓库私有，使用部署账号自身的拉取权限；不要把其个人私钥复制给网站进程。构建完成后发行版与父目录归 root，网站账号只可写 `.next/cache`；这也使 root 的备份 Git 归档可直接读取，不需要放宽 safe.directory。更新每个新发行版都执行同样的权限收口，再切 current。发行版构建需要 devDependencies 中的 tsx，暂不运行 `npm prune --omit=dev`。真实秘密只在外置配置；构建无需供应商 key 或管理员密码。随机值可用 `openssl rand -hex 32` 生成，每个字段独立生成，勿在录屏中操作。

## 3. 建库与维护权限

网站使用 `ideastage_app`，仅项目库 SELECT/INSERT/UPDATE/DELETE。初始化/迁移单独执行，网站 service **只**加载 runtime.env。不要把 MYSQL_ADMIN_*、MYSQL_MIGRATION_* 放进 runtime.env。

首次可在 `sudo mysql` 交互会话中创建专用引导账号（密码替换为单独的随机值）：

```sql
CREATE USER 'ideastage_bootstrap'@'localhost' IDENTIFIED BY '独立随机密码';
GRANT CREATE USER ON *.* TO 'ideastage_bootstrap'@'localhost';
GRANT ALL PRIVILEGES ON ideastage.* TO 'ideastage_bootstrap'@'localhost' WITH GRANT OPTION;
```

maintenance.env 的 MYSQL_ADMIN_USER/PASSWORD 对应这个账号，runtime.env 的 MYSQL_DATABASE/USER/PASSWORD 对应全新云库与应用账号。初始化会创建库、22 项迁移和专用应用账号，不导入本地用户或聊天。

```bash
sudo flock -n /run/lock/ideastage-maintenance node --import tsx scripts/production-db.ts --initialize --env /etc/ideastage/runtime.env --maintenance /etc/ideastage/maintenance.env
sudo node --import tsx scripts/production-check.ts --env /etc/ideastage/runtime.env --database
```

然后在 MySQL 交互会话创建只负责此项目库的迁移账号：

```sql
CREATE USER 'ideastage_migration'@'localhost' IDENTIFIED BY '另一独立随机密码';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON ideastage.* TO 'ideastage_migration'@'localhost';
SHOW GRANTS FOR 'ideastage_app'@'localhost';
DROP USER 'ideastage_bootstrap'@'localhost';
```

将迁移账号写入 maintenance.env，删除已失效的引导账号秘密；后续不带 `--initialize` 即只迁移。独立恢复工具需要临时管理员在随机 `ideastage_restore_*` 库建表/删库的权限，使用另一份私有恢复配置，不能给网站或日常迁移账号全局权限。

## 4. HTTPS 与进程启动

先保留 DNS-only 并让 A 记录生效。以下假定未有其他站点；若已有站点，合并配置，勿盲删原站点或默认配置。

```bash
sudo install -d -m 0755 /var/www/letsencrypt
sudo install -m 0644 deploy/ubuntu/nginx-http.conf /etc/nginx/sites-available/ideastage
sudo ln -s /etc/nginx/sites-available/ideastage /etc/nginx/sites-enabled/ideastage
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt -d ideastage.top
sudo install -m 0644 deploy/ubuntu/ideastage-proxy.conf /etc/nginx/snippets/ideastage-proxy.conf
sudo install -m 0644 deploy/ubuntu/nginx-https.conf /etc/nginx/sites-available/ideastage
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

certbot 的续期成功后必须 reload nginx 才加载新证书；配置并验证 deploy hook：

```bash
sudo install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
sudo sh -c 'printf "#!/bin/sh\n/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx\n" > /etc/letsencrypt/renewal-hooks/deploy/ideastage-nginx'
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/ideastage-nginx
```

签发前 HTTP 除 ACME 外返回 503，签发后 HTTP 跳 HTTPS。nginx 模板兼容 Ubuntu nginx 1.24，固定应用 Host/HTTPS 转发头、禁缓冲和缓存；不能把 Node 3000 端口绕过 nginx 暴露到公网。

```bash
sudo ln -s "/srv/ideastage/releases/$RELEASE_SHA" /srv/ideastage/current
sudo install -m 0644 deploy/ubuntu/ideastage.service /etc/systemd/system/ideastage.service
sudo systemd-analyze verify /etc/systemd/system/ideastage.service
sudo systemctl daemon-reload
sudo systemctl enable --now ideastage
sudo systemctl status ideastage --no-pager
sudo journalctl -u ideastage -n 80 --no-pager
curl -fsS https://ideastage.top/api/health
```

启动先校验生产配置/数据库迁移，再将上次遗留生成收为失败/中断并释放旧锁。**必须单进程且旧实例已停**；不能手动在在线实例旁运行 `--recover`，不启用 PM2 cluster、多个副本或多个共库节点。失败启动不能靠跳过预检解决。

## 5. 邀请体验和 live 开关

生产默认 `REGISTRATION_MODE=invite`。邀请码由服务端校验，不嵌入页面；当前为可轮换的共享码，可被转发，不是一次性/实名邀请码。泄露后更换外置配置并重启，新码只影响后续注册，不使已有账号退出。

默认账号每天 10 次、全站每天 100 次，北京时间零点重置，可调整 AI_DAILY_USER_LIMIT/SITE_LIMIT。聊天、编辑/重生成、润色、旧版辅助自动命名均计入真实供应商请求数；失败/停止不返还已开始的次数，自动重试已关闭。额度存 MySQL，重启不重置，replay 不计。次数限制**不是金额硬上限**，也不保证 10 轮完整聊天；真实费用还取决于输入输出长度与供应商计费，供应商侧仍需设置可用的余额/预算提醒。

首次只由维护者用 replay 验收邀请、登录、写入、删除、重启与备份。不要向体验者把回放说成实时 AI。完成后将 runtime.env 的 AI_MODE 改为 live，填实际 AI_API_KEY/BASE_URL/MODEL，离线预检通过再重启。真实模型调用及费用在目标机按短调用和长生成逐项验收，本轮未调用。

## 6. 可选 Cloudflare

直连 HTTPS 已通过后再开代理。SSL/TLS 选 Full (strict)，源站证书必须有效；不选 Flexible。API、登录/注册、工作台和其他用户动态页面不得套 Cache Everything；如有缓存规则，显式 Bypass `/api/*`、`/login*`、`/register*`、`/projects*`、`/work-records*` 及认证用户请求，静态资源使用 Next 自带缓存策略。不要缓存 SSE，不启用会改变其响应正文的转换规则。

代理前按 Cloudflare **当日官方 IPv4/IPv6 网段**配置 nginx `set_real_ip_from`，配合 `real_ip_header CF-Connecting-IP`，只信任这些来源；先 `nginx -t` 再 reload。不可信客户端不能靠伪造此头绕过认证限流；未配置可信真实 IP 时同一边缘 IP 会共用限流额度，可能误限多位用户。官方列表：https://www.cloudflare.com/ips/ 。不要将 `0.0.0.0/0` 加为可信代理。

普通代理的长请求限制并没有被取消；应用聊天和润色每 15 秒心跳，需要浏览器/源站/nginx/Cloudflare 实际逐块转发。用浏览器 Network 检查 SSE 在结果前已有 heartbeat/token，做超过 125 秒的实际生成/受控延迟验收。Cloudflare 不保证固定香港/日本节点，也不替代大陆网络实测；若失败，先切 DNS-only 对比定位，不先购买更多服务。

## 7. 每日加密备份、电脑拉取与百度网盘

```bash
sudo sh -c 'umask 077; set -C; openssl rand 32 > /etc/ideastage/backup.key'
sudo install -m 0644 deploy/ubuntu/ideastage-backup.service /etc/systemd/system/ideastage-backup.service
sudo install -m 0644 deploy/ubuntu/ideastage-backup.timer /etc/systemd/system/ideastage-backup.timer
sudo systemd-analyze verify /etc/systemd/system/ideastage-backup.service /etc/systemd/system/ideastage-backup.timer
sudo systemctl daemon-reload
sudo systemctl start ideastage-backup.service
sudo journalctl -u ideastage-backup -n 40 --no-pager
sudo systemctl enable --now ideastage-backup.timer
sudo systemctl list-timers ideastage-backup.timer
```

每日北京时间 03:00 附近运行，错过后补执行。备份与迁移用同一个 flock 锁，碰撞则失败并在 journal 留痕。包包含事务一致的 database.sql、runtime.env、metadata.json、对应 commit 的 source.tar，使用 AES-256-GCM 加密后才成为可下载包；临时明文只在私有目录，结束清理。当前应用没有额外上传目录，未来新增时必须扩充备份范围。

`latest.json` 只在加密/校验完成后更新；失败不更新它。`.isb` 与 `.sha256` 配对；密钥仅首次生成，上述命令拒绝覆盖已有密钥。密钥独立在个人安全位置另存至少一份，不能只放服务器，也不要和加密包同放共享网盘。服务器备份只是第一份，Windows 拉取成功才形成异地副本。

Windows 先安装可用的 OpenSSH 客户端，核对 SSH 主机指纹并完成密钥登录；SSH 不是 22 端口时在该用户的 `.ssh/config` 为目标配置 Port。脚本使用严格 known_hosts 验证且不交互询问密码。在普通 PowerShell 手动验证一次：

```powershell
& 'D:\Project\4.Project\Agent2\scripts\Pull-IdeaStageBackup.ps1' -SshTarget '备份读取用户@实际IP' -Destination 'D:\Backups\IdeaStage'
Get-Content 'D:\Backups\IdeaStage\last-pull.json'
```

脚本检查索引时间、文件名、SHA-256，拒绝过期（默认 30 小时）、下载失败、篡改和同名冲突；失败不会刷新 last-pull.json。把脚本复制到稳定本地目录后，在任务计划程序创建“用户登录后”（仅开机但无人登录时通常拿不到该用户 SSH 密钥）任务，选择用户账户、登录后延迟 1 分钟、每小时重试 3 次、不并行：

- 程序：系统 `powershell.exe`（或已安装的 `pwsh.exe` 的绝对路径）。
- 参数：`-NoProfile -ExecutionPolicy RemoteSigned -File "D:\Tools\IdeaStage\Pull-IdeaStageBackup.ps1" -SshTarget "备份读取用户@实际IP" -Destination "D:\Backups\IdeaStage"`。
- 启动位置：`D:\Tools\IdeaStage`；启用错过后尽快运行、需要网络；查看最后运行结果 0 和新 last-pull.json 才算成功。

脚本不自动弹桌面通知、不自动上传网盘；电脑长期关机不会产生异地成功标志。每周及重要更新后手动把 `.isb` 与 `.sha256` 上传百度网盘，并核对上传成功/大小，下载一份再做 inspect。建议人工保留最近 7 日全部包和最近 4 周每周一个包；目前**没有自动删除**，清理前先确认至少另一位置有已验证副本，保留索引当前指向的包。检查磁盘占用与最近备份时间是维护动作。

## 8. 独立恢复与灾难恢复

先校验/解密，再建随机独立库，工具不接受覆盖目标库参数：

```bash
sudo node --import tsx scripts/production-backup.ts inspect --file /恢复目录/备份.isb --key /私有目录/backup.key
sudo node --import tsx scripts/production-backup.ts restore-test --env /私有目录/restore-admin.env --file /恢复目录/备份.isb --key /私有目录/backup.key
sudo node --import tsx scripts/production-backup.ts extract --file /恢复目录/备份.isb --key /私有目录/backup.key --destination /私有目录/本次全新恢复目录
```

restore-admin.env 从 runtime.env 的 MySQL 应用连接字段复制（解析配置时需要 MYSQL_HOST/PORT/DATABASE/USER/PASSWORD），再加入 MYSQL_ADMIN_HOST/PORT/USER/PASSWORD 和 MYSQL_REQUIRED_VERSION=9.7.2，仅用于独立恢复，不给网站加载。工具实际只以管理员连接创建随机恢复库，不写入所填的应用库。工具报告随机库名、表数和各表行数；不带 `--cleanup-test` 时保留该库，便于进一步验收。仅检查行数不等于产品恢复成功。

灾难恢复在隔离机器/端口复建相同版本，解包 source.tar 并重新 `npm ci --include=dev`/build（归档不含 node_modules/.next，也不含 Git 目录；优先根据 metadata.commit 从仓库重新 clone）。重建专用应用账号并只授权已恢复的随机库，将私有 runtime.env 中 MYSQL_DATABASE 指向该库，轮换泄露/失效的密钥，再以独立实例和域名检查旧账号登录、项目/文件正文、聊天、HTML 快照、生成恢复。配置/SQL 明文不要进入网盘同步目录。

首次及每月做一次恢复演练；验收后只删除明确记录的本次测试库。自动测试可添加 `--cleanup-test`，此时会清理工具实际创建的随机库。正式切换前先停旧实例，确认数据与新备份，再切配置/域名。代码回退不能擅自倒退数据库；如迁移不向后兼容，需停写并在隔离恢复后核对接受的数据损失时间窗。

## 9. 更新与回退

新 SHA 在新的 releases 目录 clone、npm ci、build，在线版本不原地构建。记下旧 current 的真实路径。停写前先运行备份并**拉到本机**，确认成功；随后：

```bash
sudo systemctl stop ideastage
cd /srv/ideastage/releases/新SHA
sudo flock -n /run/lock/ideastage-maintenance node --import tsx scripts/production-db.ts --env /etc/ideastage/runtime.env --maintenance /etc/ideastage/maintenance.env
sudo node --import tsx scripts/production-check.ts --env /etc/ideastage/runtime.env --database
sudo ln -s /srv/ideastage/releases/新SHA /srv/ideastage/current.next
sudo mv -Tf /srv/ideastage/current.next /srv/ideastage/current
sudo systemctl start ideastage
curl -fsS https://ideastage.top/api/health
```

迁移失败时保持停机，查看维护日志，不跳过 checksum、不手工删迁移记录。只在确认数据库仍兼容旧代码时，停新实例、以同样软链接步骤切回旧发行版、启动并验收；否则走独立恢复方案。保留上一发行版与更新前备份，不运行不明范围的递归清理。

## 10. 目标机发布闸

以下必须在真实服务器逐项留证，不能用本地 replay 或模板存在代替：

1. 软件版本/磁盘持久化/端口隔离；nginx -t、systemd-analyze verify 与实际服务启动。
2. 域名 HTTPS、证书续期 hook、健康 200；DB 断开时健康 503且不泄露秘密。
3. 邀请缺失/错误被拒绝，正确邀请码注册登录；HTTPS cookie、退出和重新登录，两个账号数据隔离。
4. 项目/迭代/文件/候选/任务/快照持久化，刷新后恢复；重启服务后成功事实保留、旧生成结束并可重试。
5. 显式 live 后短调用、长生成逐步显示/心跳、停止/断线/编辑/重生成、润色预览；限额错误可理解。
6. Cloudflare 开关对比大陆真实访问，心跳不缓冲、认证/API 不缓存、不串账号，限流识别真实来源。
7. 手动/定时备份、Windows 实际拉取与漏拉错误、网盘上传下载、隔离恢复后的真实登录和数据检查。

通过这些后才邀请用户体验。当前代码侧准备可以先于服务器和 DNS 完成；购买后仍需填入真实参数、执行安装部署与上述发布闸。
