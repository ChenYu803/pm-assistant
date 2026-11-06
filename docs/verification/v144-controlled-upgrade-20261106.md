# v1.44 #14 2026-11-06 受限增量升级记录

## 结论与边界

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
