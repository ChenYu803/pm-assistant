# v1.44 #14 本次升级执行单

2026-11-06 13:12（Asia/Shanghai）续执行状态：已安全注入live模型及管理员配置、限制普通公网、停止旧站、完成最新备份隔离恢复、增量迁移至32项并切换到精确候选33df4878d3a2a30b2e9621211410cfb4a6fd27ab，网站active/HTTPS health200；usage-recovery真实定时触发通过。升级后加密副本亦下载解密并隔离恢复35表/32迁移。**仍未完成真实注册与登录态验收，不标受控验收就绪或resolved。** 原库无账号/项目，下一步见第4.1节；完整证据见[续执行记录](verification/v144-controlled-upgrade-20261106.md)。以下保留操作方法，已完成的迁移和备份不应盲目重跑。

## 1. 运行配置准备（邮件字段已完成）

用户已选择腾讯云 SES，广州，注册模板 68248、找回模板 68249，发信地址 noreply@mail.ideastage.top；用户确认域名和模板已验证／审核通过。详见[接入记录](tencent-ses-setup.md)。SecretId／SecretKey已私下填入 /etc/ideastage/email-ses.env，并在核对字段状态、权限和变更前安全副本后合入runtime，原其余字段保留；变更后副本也已下载并认证解密。两个配置文件均root:root 0600。不再要求 RESEND_API_KEY，用户无须重复填写密钥；真实权限和收信交 #15。

第1节已续执行：从本机已有配置通过SSH stdin安全注入模型密钥/API地址/模型，AI_MODE=live、ADMIN_EMAILS=3037116719@qq.com，原其余字段保留；变更前后加密副本已下载解密，网站实际进程与runtime匹配。维护密码未合入runtime。配置匹配不代表真实模型、价格或收信已验收，仍交#15；真实微信未配置，联系充值未开放。

先将 RELEASE_DIR 设置为已核实的新候选绝对目录，执行以下离线检查，不连接数据库或调用邮件/模型，必须退出0才可继续：

~~~bash
cd "${RELEASE_DIR:?请先设置已核实的新候选发行目录}"
sudo /usr/bin/node --import tsx scripts/production-check.ts --env /etc/ideastage/runtime.env
~~~

## 2. 受限入口和最新恢复点

先备份现有nginx站点，设置仅127.0.0.1/::1可访问的限制，通过SSH隧道验收。策略同时覆盖源站和Cloudflare路径，业务API和注册不留公网例外。nginx -t成功才reload，取得公网拒绝、回环HTTPS可访问的证据；#15前不得移除。

受限后停止旧网站，确认无活动生成或运营写入，再执行既有备份任务，下载新包、本机独立密钥解密，并在随机隔离库实际恢复。同步保存维护/入口配置的加密副本。不得用此次早前快照冒充未来变更前最新快照。若业务仍为空如实记录；若出现真实账号/正文，补相应恢复验收。

## 3. 增量迁移与切换

已停旧实例并验证最新快照后，在候选目录执行，每步失败即停止：

~~~bash
sudo flock -n /run/lock/ideastage-maintenance /usr/bin/node --import tsx scripts/production-db.ts --env /etc/ideastage/runtime.env --maintenance /etc/ideastage/maintenance.env
sudo /usr/bin/node --import tsx scripts/production-check.ts --env /etc/ideastage/runtime.env --database
~~~

核对32项迁移和原业务行保留，网站账号保持项目库DML。不运行db:init/--initialize，不清表、重设应用凭据或虚构邮箱验证。旧维护管理员凭据当前失效，如需在目标机隔离恢复，先从独立保存的KeePass条目找回有效凭据，不猜密码或覆盖正式库。

核实current.next不存在后新建候选链接，再以mv -T原子替换current；若已有未知路径，先检查，禁止覆盖。启动ideastage，核对真实HEAD、ExecStartPre与localhost health。失败保持受限状态，按下述方案恢复。

## 4. 登录态验收、恢复调度及交接

目标HTTPS入口通过正常登录验证个人中心、项目和关键正文，检查v1.43视觉及v1.44界面。原库无用户时，旧账号验收记录不适用；由运营者经真实邮件注册验收账号，不能伪造Cookie、验证时间或插入假账号冒充旧数据。无登录账号时保留待办，未登录跳转不算通过。

按[调度说明](pending-usage-recovery.md)安装候选service/timer，daemon-reload、手动start、enable --now。记录真实WorkingDirectory/User/EnvironmentFile、当前提交及目标数据库，核对failed=0、Result=success、ExecMainStatus=0、下一次执行时间和一次实际定时触发。核对系统时钟同步，不推进生产时钟或故障注入。无待核对行时scanned=0仅证明调度运行，不宣称实际到期释放通过。

全部完成后刷新源码/数据库/配置的加密副本，下载并解密/恢复核验，保持受限。才可将#14标为受控验收就绪，交#15继续真实收信、模型逐笔对账、200元累计预算、微信及正式开放。

### 4.1 在用户电脑打开受限验收入口

目的：只让用户自己的电脑通过现有SSH身份访问正式HTTPS站点，保留普通公网403。以下只建通道与打开独立浏览器，不更改服务器数据库或网站权限，不填新凭据，不修改Windows hosts。自动启动请求被本机安全策略拦截，因此这两步需用户亲自执行。

1. 打开PowerShell，执行以下命令并**保持这个窗口打开**。正常会持续运行而没有输出；退出表示通道失败，应先看错误，不继续注册。

~~~powershell
ssh -N -T -i "D:\SSH_pem\IdeaStage_SSH_2026.pem" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -L 127.0.0.1:443:127.0.0.1:443 ubuntu@101.33.79.30
~~~

2. 再打开一个PowerShell窗口，执行以下命令。它用独立Chrome配置只把本窗口的ideastage.top解析到本机SSH入口，不影响日常浏览器；仍验证正式域名的HTTPS证书，不跳过任何证书校验。

~~~powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="C:\Users\Administrator\.ideastage-recovery\v144-browser" "--host-resolver-rules=MAP ideastage.top 127.0.0.1" --no-proxy-server "https://ideastage.top/register"
~~~

页面正常打开后，以3037116719@qq.com注册，自行设置密码、收取并填写真实验证码。密码/验证码不发聊天。注册成功后告诉代理“已注册并登录”，代理继续核实正式库账号状态及新增恢复点。当前独立Chrome未开启调试连接，代理不能直接接管该登录窗口；用户需在该窗口依次打开/profile（个人主页、账号与积分）、/admin（用户管理、当前账号正常）、/projects（项目界面），反馈页面是否正常。原库无项目时不以空项目页声称历史正文已验收；注册成功本身不等于全部发布闸通过。

成功判据：专用浏览器能在无证书警告下打开真实域名注册页，普通浏览器/公网仍403。如果端口443已被占用或出现证书警告，停止并报错误原文，不关防火墙、不忽略证书、不重复改DNS。结束验收先关闭专用Chrome，再在隧道窗口按Ctrl+C即可撤销访问；独立浏览器资料留在本机受限目录，不入Git/备份源码。

## 5. 资金事实兼容的失败恢复

保留nginx限制，停新模型和运营写入，停止网站及usage-recovery.timer，核实已启动oneshot结束。写入全停后保存故障现场完整加密备份、服务器外副本、实际提交及日志。

新增积分、模型结算、充值、退款、邀请码领取或审计事实出现后，不能用旧库覆盖当前库。以当前增量库为准优先修正前进；旧快照只恢复到新隔离库核对，外部退款结果不明的held不能当作未付款释放，不重复外部转账。

仅在验证旧代码与当前结构、数据及资金约束兼容后才能单独回退代码链接，否则保持受限、暂停写入并修复。灾难恢复先恢复到新库，逐项核对升级后新增账本和外部收退款事实，未经核对不开放或重复扣退款。密钥、系统账号及有效管理员凭据从独立保存位置恢复，不通过重设原账号冒充找回。
