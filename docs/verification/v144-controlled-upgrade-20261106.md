# v1.44 #14 2026-11-06 受限增量升级记录

最新结论：#14已resolved，交付“受控验收就绪”。用户已确认正式站三个登录态基础页面，并反馈隔离恢复环境原账号密码登录成功；临时应用/库/账号/私有会话已实际清理。最终只读核验网站及恢复timer正常、回环HTTPS200、公网和源站403。#15负责剩余真实能力与正式开放，详见文末“恢复登录确认与最终交付”。以下保留各阶段当时的事实，不将早期未验收状态当作当前结论。

## 13:12阶段结论与边界（历史状态）

- 实际运行提交：33df4878d3a2a30b2e9621211410cfb4a6fd27ab；current精确指向同名发行目录，root核验HEAD与干净工作区，不由目录名推断。
- 旧实际提交：77c76768a6ad1d6a9bcc02389bfc08ba465b6345；旧发行目录名存在历史差异，已保留。
- 2026-11-06约13:07（Asia/Shanghai）完成切换，网站active，回环真实域名HTTPS健康/注册/登录均200；公网经Cloudflare及直接源站均403。
- **票保持needs-info，尚未受控验收就绪**：原库账号/项目/文件均0，未创建假账号、伪造登录cookie或邮箱验证状态。真实注册/收信与登录态界面、个人中心和项目正文仍未验。
- 未发送真实邮件、付费模型请求、执行充值/退款/赠送或push。测试替身字段未配置；真实CAM权限、送达、供应商模型标识/价格和计量仍待#15。

## 实际执行

1. 先备份现有源码/数据库/runtime和含SES/维护/nginx/systemd的补充配置，下载至用户电脑受限目录，SHA-256及AES-256-GCM认证解密通过。
2. 经SSH stdin而非命令行/聊天传入本机已有模型密钥；持维护锁，将AI_MODE=live、官方端点https://api.deepseek.com、既有模型deepseek-v4-flash及ADMIN_EMAILS=3037116719@qq.com原子合入runtime。保留其余字段与0600/root权限，验证无重复字段。变更后再备份、下载和解密。后续核验实际网站进程与runtime一致且密钥匹配，不输出值；这不是供应商在线可用证明。
3. 先保留nginx旧站点文件，再用http级map和server级拒绝规则按$realip_remote_addr真实连接对端限制，只允许127.0.0.1/::1，不把可伪造访客头或Cloudflare出口误认为验收者。HTTP/HTTPS两个站点及业务API无公网例外；nginx -t成功后reload。
4. 独立探测Cloudflare及源站健康403；后续额外检查根路径、健康、注册和credentials路径均403。回环真实域名HTTPS健康200。停止旧站并确认3000监听已消失后刷新完整及补充备份，下载/解密。
5. 在本机MySQL9.7.2随机新库恢复停站快照（22表/22迁移），与正式库逐表行数及迁移id完全一致。业务均空，故不宣称登录/正文恢复；演练库与临时私有mysql客户端配置已清理，无SQL/运行配置明文文件落盘。
6. 候选目录真实HEAD和工作区核验通过后，通过已有迁移账号执行production-db.ts增量迁移，未使用--initialize、db:init、清库或重设凭据。正式MySQL9.7.4现35表/32迁移，0001–0022保留，新增0023–0032；原账号/项目/文件等仍0行，应用权限仅项目DML。
7. 确认current.next不存在，用ln -s及mv -T原子切换，启动网站。生产启动预检/迁移检查通过，service active、Result=success、ExecMainStatus=0、HTTPS health200。
8. 安装并启用usage-recovery.service/timer，User=ideastage，WorkingDirectory=/srv/ideastage/current，EnvironmentFile=/etc/ideastage/runtime.env。13:07:49手动执行，13:08、13:09及之后真实定时触发，日志scanned=0/failed=0；timer active、时间同步。未推进时钟或注入故障，无待处理队列不等于到期释放通过。
9. 升级后标准与补充包再次下载并解密，在本机随机库恢复35表/32迁移，与正式库逐表计数及迁移一致，演练资源清理。解密密钥继续在C:/Users/Administrator/.ideastage-recovery/backup.key独立保管，未输出或入Git。

## 备份证据

本机目录：D:/Backups/IdeaStage/v144-ses-20261106，ACL仅Administrators与SYSTEM。各标准包及补充包的完整文件名、SHA-256、时间与认证解密结果见对应JSON：

| 阶段 | 证据 | 标准备份 | 实际恢复 |
| --- | --- | --- | --- |
| live配置前 | [before-live-config-backup.json](v144-tencent-ses/20261106/before-live-config-backup.json) | 2026-11-06T05-03-01-961Z-3d17fc37.isb | 未恢复，仅解密 |
| live配置后 | [after-live-config-backup.json](v144-tencent-ses/20261106/after-live-config-backup.json) | 2026-11-06T05-03-38-767Z-86762832.isb | 未恢复，仅解密 |
| 停站迁移前 | [stopped-before-migration-backup.json](v144-tencent-ses/20261106/stopped-before-migration-backup.json) | 2026-11-06T05-05-16-267Z-e56b937f.isb | [22表/22迁移](v144-tencent-ses/20261106/stopped-before-migration-restore.json) |
| 升级后 | [after-upgrade-backup.json](v144-tencent-ses/20261106/after-upgrade-backup.json) | 2026-11-06T05-08-02-844Z-a9049f99.isb | [35表/32迁移](v144-tencent-ses/20261106/after-upgrade-restore.json) |

这些恢复使用本机随机新库，不覆盖正式库。普通用户进入前始终保持nginx限制；后续出现资金事实后严禁以旧快照覆盖当前库。回退沿用[执行单第5节](../v144-production-upgrade-runbook.md#5-资金事实兼容的失败恢复)。

## 已知失败与独立复核

- 本机Node沙箱内SSH退出255，无配置更改；改用已支持的终端执行器执行正常SSH，不再通过该沙箱发起连接。
- 临时运维恢复脚本前两次在本机语法检查阶段失败，未执行恢复或迁移；后续重写该分支、先node --check，再完成上述两次真实隔离恢复。脚本仅留在受限备份目录，不是部署业务源码。
- 配置/调度批处理尾部journalctl参数受PowerShell管道结尾CR影响失败，批处理退出1；此前迁移与timer已生效。独立SSH复核journal日志、真实定时触发及Result/ExecMainStatus通过，不把失败批次标为全成功。原始日志：[target-runtime-and-timer.log](v144-tencent-ses/20261106/target-runtime-and-timer.log)。
- 初次最终快照尝试在旧发行目录读取origin失败（未配置远端），退出128；一次非root读取新发行库HEAD被Git所有权保护拒绝。未通过放宽safe.directory解决，而是用root重新核验实际HEAD及干净工作区。最终独立结果见[target-final-independent.log](v144-tencent-ses/20261106/target-final-independent.log)。本机GitHub即时ls-remote因连接失败不可用；缓存origin/codex-pm-assistant-v1.1-docs为77c7676，不冒充当前远端实际值。
- 自动创建本机验收SSH隧道/启动浏览器的执行请求被本机安全策略拒绝，未落隧道状态或修改hosts。后续只需用户运行[手动受限入口步骤](../v144-production-upgrade-runbook.md#41-在用户电脑打开受限验收入口)并真实注册，不重复填写SES或模型凭据。

## 下一步与职责

- #14：经真实邮件注册指定管理员账号，正常登录后核验个人中心、管理员授权、v1.43视觉和v1.44界面及项目/正文。当前无旧账号/正文，不伪造旧数据验收。
- #15：真实注册/找回收信及CAM核验、供应商官方模型/价格与用量逐笔对账、主动停止及累计200元预算、运营微信和最终公开发布。现阶段联系充值未开放；不能因已live就声称模型真实调用成功。
- 暂时保留普通公网403，直至发布闸通过；不要为了登录方便开放公网。

## 附属运行证据

[live配置状态](v144-tencent-ses/20261106/live-config-status.json)、[运行进程配置匹配](v144-tencent-ses/20261106/running-process-config.json)、[入口策略](v144-tencent-ses/20261106/restricted-entry-status.json)、[公网/回环探测](v144-tencent-ses/20261106/restricted-entry-http.json)、[迁移/启动日志](v144-tencent-ses/20261106/target-upgrade.log)、[实际定时触发](v144-tencent-ses/20261106/timer-scheduled-check.log)。

## 本轮验证与独立审查

主代理：tsc --noEmit、git diff --check、23份本轮文件的凭据特征扫描/JSON解析、备份认证解密状态与运行进程配置证据一致性、两段手动PowerShell命令纯语法解析均通过；未重新运行此前有效的业务离线回归。末次正式服务和timer均active、Result=success/ExecMainStatus=0、回环HTTPS健康200。直接源站请求附带伪造CF-Connecting-IP/X-Forwarded-For/X-Real-IP=127.0.0.1仍403。

### Standards

固定范围git diff a92b797...1214f6c；已确认硬性违规0、Fowler启发式发现0。备份解密、实际恢复、空业务与登录验收边界，失败批次与独立复核、票needs-info状态均如实记录。仅静态审查已读规则/文档差异及部分证据，未逐份完整阅读全部23份文件，也未独立访问服务器，不将局部静态审查当作全面重验。

### Spec

同一固定范围，真实问题0：虚报0、额外范围0、可确认配置/操作错误及证据矛盾0。未完成的#14真实登录/视觉/远端即时核验和#15真实邮件/模型/预算/微信/开放仍明确待办。只读仓库文档与证据，不独立重验目标机或备份实体。

两轴已确认发现各0；Standards覆盖有上述限制。

## 真实注册后复核与新增恢复点

2026-11-06，用户确认已经通过专用SSH入口注册并登录，询问能否关闭通道。告知保持通道和当前登录窗口，随后只读正式库复核，未索取密码、验证码或Cookie。

- 13:24（Asia/Shanghai）：指定账号存在、active、邮箱已验证，匹配ADMIN_EMAILS；注册验证码state=used且code_digest已清除。users=1，projects/project_files/model_requests/credit_entries均0。真实注册反馈及消费记录支持注册邮件链路成功，不证明找回模板或完整CAM最小权限通过。详见[账号与服务证据](v144-tencent-ses/20261106/registered-account-check.json)。
- 发行HEAD仍33df4878d3a2a30b2e9621211410cfb4a6fd27ab；网站与恢复timer均active，恢复Result=success/ExecMainStatus=0。回环健康200，公网与直接源站健康403。该次状态核验没有读取密码哈希、验证码或会话令牌，也没有新增模型、资金或项目写入。
- 13:26：标准包2026-11-06T05-25-12-723Z-79df57d3.isb（SHA-256 0adfbff5f5831d6ded678724af08983f10ad42ceeaa5fd3375f67dd9695775fc）与同阶段配置补充包已下载至既有受限备份目录，并使用独立既有密钥认证解密、核对必需成员；未将明文配置落盘。详见[注册后备份](v144-tencent-ses/20261106/after-registration-backup.json)。
- 13:28：该新标准包已在本机MySQL9.7.2随机新库实际恢复，35张表/32项迁移及逐表行数均与正式库一致，另确认指定真实账号active且邮箱验证时间保留。演练库及临时私有客户端配置已清理。详见[注册后恢复](v144-tencent-ses/20261106/after-registration-restore.json)。旧空库备份不作为新账号恢复证据。

恢复验证未使用用户密码正常登录隔离库，且正式库没有项目和正文，因此loginAndContentValidation仍为false；没有把行数和字段核对当作完整登录、正文恢复。用户当前Chrome未启用可附加调试连接，代理未接管会话或导出Cookie。页面验收待用户在当前登录窗口打开/profile、/admin、/projects，确认账号与余额、管理后台及项目界面正常；此时通道先保持打开。原库无旧账号或旧资料，历史数据页面验收不适用。#14继续needs-info，不宣称受控验收就绪或正式开放。

本轮重试只读git ls-remote成功：origin的refs/heads/codex-pm-assistant-v1.1-docs仍指向77c76768a6ad1d6a9bcc02389bfc08ba465b6345。此前连接失败事实保留，本次已取得即时远端状态；目标版本33df487由本机Git bundle送达，尚未推送。见[远端查询](v144-tencent-ses/20261106/remote-ref-check.json)。未执行push，仍待用户授权。

本轮补记验证：tsc --noEmit、git diff --check通过；8份新增/改动文件凭据特征扫描0命中，新增JSON均可解析。备份目录及独立密钥ACL仍仅Administrators/SYSTEM，未残留restore-临时目录。既有有效业务回归未重复执行。

本轮code-review固定范围8d95ade...2321d2f，Standards与Spec各由独立代理完整阅读8文件新增差异及4份新增JSON，已确认问题均0；只做静态规则、规格和证据内部一致性审查，未独立连接服务器、操作备份或验收浏览器。

## 登录态页面人工确认

用户在上一轮提供的三个地址检查说明后反馈“三个页面均正常”。因此正式站/profile、/admin、/projects的检查记录为用户人工确认，非代理控制浏览器取得的自动化证据。指定账号真实登录后个人主页、积分信息和管理后台入口、后台用户管理及当前空项目页均按既定检查点确认正常；未采集截图，未开展详细视觉或响应式审计。记录时间为2026-11-06T05:36:26.198Z，不将此时间冒称用户操作的精确发生时间。见[人工确认JSON](v144-tencent-ses/20261106/authenticated-pages-user-confirmation.json)。

升级前账号、项目和关键正文均为空，旧账号与旧正文验收不适用；恢复新账号后的状态及计数已核对，但尚未让用户在隔离恢复应用中实际登录，该项仍未通过。#14继续needs-info，尚不标受控验收就绪/resolved；下一步准备隔离应用并让用户自行正常登录，不索取密码、验证码或Cookie。

正式站当前无需继续占用用户专用通道，已告知先关闭专用Chrome，再在SSH通道窗口Ctrl+C；未擅自终止用户进程，也未宣称用户已实际关闭。关闭只影响其专用访问，正式服务继续运行，nginx受限策略不变。#15的找回邮件、真实模型/成本/预算/运营微信与正式开放仍未通过，未新增付费请求或推送。

## 本机隔离恢复应用待正常登录

在用户已确认正式站三个页面后，继续补齐恢复后的正常登录证据。使用注册后快照2026-11-06T05-25-12-723Z-79df57d3.isb，认证解密后从database.sql恢复到本机新库ideastage_login_369dcd9acd50fd28，源码从同包source.tar提取，1387个源码文件逐一计算Git blob并匹配33df4878d3a2a30b2e9621211410cfb4a6fd27ab。依赖package.json/package-lock.json与当前已安装版本一致，复用node_modules junction。运行Next dev --webpack以验证恢复数据的应用登录，未更改认证实现，不将其称为目标机生产构建复验。

一次性DML应用账号仅能读写该隔离库；私有会话文件保存其临时数据库凭据和独立AUTH_SECRET，位于D:/Backups/IdeaStage/v144-ses-20261106/login-recovery-369dcd9acd50fd28，实际ACL仅Administrators/SYSTEM，应用不持有管理员/迁移/生产模型/邮件凭据。源码和本机还原库没有对公网开放，监听127.0.0.1:3444；health/login均200，未登录profile302到/login?callbackUrl=%2Fprofile，正常身份校验未绕过。证据见[隔离准备](v144-tencent-ses/20261106/isolated-login-preparation.json)。

本轮备份源码校验最初两次因Git自定义ls-tree输出将中文路径转义而在创建任何隔离数据库前停止；随后只读对照Git与归档文件名，确认1387项无缺失，以core.quotepath=false读取真实路径后逐文件校验成功。没有在未知路径不一致时继续导入或启动。

当前尚待用户通过本机登录页自行输入已注册的原账号和密码并确认个人主页，不能据health200或未登录跳转声称恢复登录通过。无需服务器专用通道，用户可关闭此前专用Chrome和SSH通道。临时应用与数据库为该步骤有意保留，cleanupComplete=false。清理程序D:/Backups/IdeaStage/v144-ses-20261106/cleanup-login-recovery.cjs已准备并通过node --check，待用户反馈后核对临时资源身份、停止进程树及确认端口关闭，删除临时账号/隔离库/私有会话；目前未执行、不宣称已清理，源码副本会留在受限目录。


## 恢复登录确认与最终交付

2026-11-06，用户明确反馈“恢复环境登录成功”，并说明直接关闭SSH通道终端。恢复环境来自注册后真实加密包2026-11-06T05-25-12-723Z-79df57d3.isb，其数据库和33df487对应源码在本机隔离恢复，账号与邮箱验证状态保留，1387个源码文件逐一Git blob核验一致。此次正常登录由用户自行输入原账号密码并人工报告，未自动接管浏览器、索取或导出凭据；仅证明恢复后账号登录正常，不扩大为正文、窄屏或生产构建复验。升级前及注册后快照的projects/project_files均0，因此历史项目和正文恢复检查不适用。见[恢复登录确认](v144-tencent-ses/20261106/isolated-login-user-confirmation.json)。

清理于2026-11-06T05:59:51.026Z完成（北京时间13:59:51）：校验进程身份后停止监督和应用进程，3444无监听，删除本轮随机库ideastage_login_369dcd9acd50fd28、一次性账号restore_login_369dcd9acd50fd28及private-session.json。保留受限备份包与源码副本，未递归删除node_modules junction。清理读取恢复库时users=1、active、邮箱已验证、32项迁移/35表；未修改正式库。用户关闭终端后另行只读确认本机443无监听，通道已退出，不影响服务器服务。见[实际清理结果](v144-tencent-ses/20261106/isolated-login-cleanup.json)。

最终SSH只读复核真实current路径及Git HEAD为33df4878d3a2a30b2e9621211410cfb4a6fd27ab，发行工作区干净；网站与usage-recovery.timer active，恢复服务Result=success/ExecMainStatus=0，回环HTTPS健康200，普通公网和直接源站均403。空队列运行证据仍不能替代24小时到期释放。见[最终检查](v144-tencent-ses/20261106/controlled-ready-final-check.json)。

#14全部AC完成并标resolved，交付“受控验收就绪”，frontier推进#15。注册邮件真实链路已有用户正常注册及正式库验证码消费证据；找回邮件、CAM完整最小权限、官方模型/逐笔计量/停止、历史成本和累计200元预算、运营微信及正式开放仍待#15。保持nginx受限入口，无新增付费模型调用、资金操作或push；本地新增记录不改变正式运行提交。

本次收尾检查：tsc通过，4份收尾JSON解析与一致性核对、9份改动文件凭据特征扫描及git diff --check通过。随后双轴审查固定e0ff4de...f77a84a，含准备与最终收尾两提交，完整覆盖10文件及5份新增JSON；Standards/Spec各0问题，仅静态审查，未独立复验运行事实。见[双轴报告](v144-tencent-ses/20261106/controlled-ready-review.md)。本段及审查报告为后续归档，不冒称属于被审查范围。
