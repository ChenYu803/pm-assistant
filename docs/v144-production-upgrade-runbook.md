# v1.44 #14 本次升级执行单

2026-11-04。候选a20931375da54551ee348dfa983a5271830c31ad已在目标机同名releases目录构建。**下列继续升级步骤尚未执行。** 当前状态见[记录](verification/v144-production-upgrade.md)。没有真实邮件配置时不得停站、迁移或切换。

## 1. 私下补齐运行配置

运营者在已有服务器SSH终端执行 sudoedit /etc/ideastage/runtime.env，保留原字段，仅新增/更新真实RESEND_API_KEY及服务商已经验证的EMAIL_FROM。不要将真实密钥发到聊天/Git，不填占位值，文件保持root:root 0600。若发信身份尚未验证，先在既有服务中完成验证，不自动购买服务。填写后代理只核对状态和权限，真实收信交#15。

代理在配置变化前后保存加密及服务器外副本，从本机已有官方配置安全注入live密钥/API地址/模型，设置ADMIN_EMAILS=3037116719@qq.com，不重复询问管理员身份。维护密码不得合入runtime。真实微信交#15，未配置时联系充值未开放。

在候选目录执行以下离线检查，不连接数据库或调用邮件/模型，必须退出0才可继续：

~~~bash
cd /srv/ideastage/releases/a20931375da54551ee348dfa983a5271830c31ad
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
