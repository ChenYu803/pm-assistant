# v1.44 #14 本次升级执行单

2026-11-06 更新。邮件补丁的新精确候选33df4878d3a2a30b2e9621211410cfb4a6fd27ab已在目标机重新安装依赖、build、tsc及离线预检通过，6项SES字段已合入runtime并完成变更前后服务器外加密副本解密核验。旧站未重启、current未切换。**第2节及之后的受控升级步骤尚未执行。** 本轮证据见[邮件接入核验](verification/v144-tencent-ses.md)，旧盘点见[记录](verification/v144-production-upgrade.md)。不得把邮件字段齐备或离线预检当作真实授权／收信通过；受限与迁移前仍须刷新最新恢复点。

## 1. 运行配置准备（邮件字段已完成）

用户已选择腾讯云 SES，广州，注册模板 68248、找回模板 68249，发信地址 noreply@mail.ideastage.top；用户确认域名和模板已验证／审核通过。详见[接入记录](tencent-ses-setup.md)。SecretId／SecretKey已私下填入 /etc/ideastage/email-ses.env，并在核对字段状态、权限和变更前安全副本后合入runtime，原其余字段保留；变更后副本也已下载并认证解密。两个配置文件均root:root 0600。不再要求 RESEND_API_KEY，用户无须重复填写密钥；真实权限和收信交 #15。

第1节余下待办：本轮未切换AI_MODE或注入模型密钥，也未设置管理员白名单；离线门禁允许replay，不能据此宣称live已就绪。继续前应在配置变化前后保存加密及服务器外副本，从本机已有官方配置安全注入live密钥/API地址/模型，设置ADMIN_EMAILS=3037116719@qq.com，不重复询问管理员身份。维护密码不得合入runtime。真实微信交#15，未配置时联系充值未开放。

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

## 5. 资金事实兼容的失败恢复

保留nginx限制，停新模型和运营写入，停止网站及usage-recovery.timer，核实已启动oneshot结束。写入全停后保存故障现场完整加密备份、服务器外副本、实际提交及日志。

新增积分、模型结算、充值、退款、邀请码领取或审计事实出现后，不能用旧库覆盖当前库。以当前增量库为准优先修正前进；旧快照只恢复到新隔离库核对，外部退款结果不明的held不能当作未付款释放，不重复外部转账。

仅在验证旧代码与当前结构、数据及资金约束兼容后才能单独回退代码链接，否则保持受限、暂停写入并修复。灾难恢复先恢复到新库，逐项核对升级后新增账本和外部收退款事实，未经核对不开放或重复扣退款。密钥、系统账号及有效管理员凭据从独立保存位置恢复，不通过重设原账号冒充找回。
