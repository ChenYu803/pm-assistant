# v1.44 #14 腾讯云 SES 接入验收

日期：2026-11-05。实施基准：5c219e93ce30bab5103a114a1eff02a8062cc52b。范围为用户已选择的邮件供应商切换与凭据暂存，不代表 #14 升级完成。

## 静态与离线证据

- npx tsc --noEmit：退出0。
- npm run build：退出0，包含腾讯云SDK的生产构建完成。
- npm run verify:v144-tencent-ses：8通过／0失败；外部请求0，数据库写入0。覆盖注册／找回模板隔离、即时通道、单收件人、生产门禁字段、无Resend依赖、非法配置拒绝、上游失败无敏感信息／无自动重试、缺MessageId拒绝成功。

SDK适配专项仅替换公开SendEmail调用，不替换验证码生成与认证逻辑。它证明请求构造和错误语义，不证明实际签名授权、模板内容或邮箱送达。

## 隔离回归

首次 verify:v144-email-auth：304通过／4失败，证据目录 C:/Users/ADMINI~1/AppData/Local/Temp/v141-email-auth-IDIuae。失败包含第61次验证码验证预期429而实际400、缺少重试时间、通用限流累计210而预期151，以及运行器汇总失败。场景于北京时间12:44:10–12:45:22跨过十五分钟固定窗口；相关限流源码和场景断言与实施基准一致。保留原断言的单次复核通过，证据高度支持固定窗口与脚本累计计数不一致；未单独检出旧提交复跑，不能宣称旧提交已复现或问题已修复。

诊断子代理未修改代码或断言，五项均退出0；主会话已核对日志末尾的结果与随机测试库／账号清理记录：

| 专项 | 通过／失败 | 主日志（Windows临时目录） |
| --- | --- | --- |
| verify:v144-email-auth | 249／0 | ses-isolation-email-auth-20261105-1249.log |
| verify:v144-email-unconfigured | 11／0 | ses-isolation-email-unconfigured-20261105-1250.log |
| verify:v144-auth-limits | 84／0 | ses-isolation-auth-limits-20261105-1251.log |
| verify:v144-auth-signout | 30／0 | ses-isolation-auth-signout-20261105-1252.log |
| verify:v141-replay-foundation | 101／0 | ses-isolation-replay-foundation-20261105-1253.log |

日志位于 C:/Users/Administrator/AppData/Local/Temp；五项合计475通过／0失败，使用随机隔离库、邮件替身与replay，未访问真实邮件、真实模型或生产数据库。所有已启动任务正常结束，无遗留测试夹具。本轮未重跑整套发布回归，目标机构建、配置门禁与真实收信仍待验，不能以这些本机结果解除#14阻断。

## 目标机与安全边界

- SSH严格主机校验成功；旧站ideastage.service为active，仅读取/etc/ideastage/runtime.env。
- 新建/etc/ideastage/email-ses.env，os.O_EXCL防止覆盖，root:root 0600；SecretId、SecretKey空，其余地域／模板／发信地址预填。没有读取、输出或接收用户的真实腾讯云凭据。
- 用户已确认域名验证、发信地址、两个模板审核及子用户密钥保存；实际API授权和收件箱仍待验收。
- 未改runtime、重启网站、更新current、执行数据库迁移、发真实邮件／模型请求或push。
- 旧候选a209313不含本次改动，后续发布必须纳入新精确提交并重新取目标机构建及预检证据。

## Standards

独立审查代理：硬违规0项，具有实质影响的Fowler异味0项。审查完整基准差异，包含新文件；重点核对SDK仅由服务端路由进入、供应商异常统一转换为安全提示、生产和发送共用校验、隔离进程清除腾讯云配置，以及文档中的备份和新候选边界。只读审查未运行测试。

## Spec

独立审查代理：本轮遗漏0项、范围蔓延0项、确定性实现错误0项。按用途选择TemplateID及code参数、无配置不能伪成功、缺MessageId拒绝成功和生产禁止替身均符合规格。真实授权和收信仍属后续验收，不视为本次补丁已完成。

规范轴0项／规格轴0项；两轴均未发现需修复问题。#14仍needs-info，下一步为用户私下填写独立暂存文件，随后在刷新安全副本的前提下核对并合入运行配置。真实邮件收信仍由#15验收。

## 2026-11-06：凭据核验、正式配置合并和新候选准备

本轮基准／目标候选为33df4878d3a2a30b2e9621211410cfb4a6fd27ab。属于生产配置L2准备操作；未修改业务源码，不重复昨日已通过的本机SDK专项和认证回归。

- 用户反馈已填写。经SSH脚本只返回状态：两项凭据存在、字母数字长度格式合理、非已知占位词；四项非敏感字段与已确认值一致，无重复／额外字段。暂存文件为普通文件、非符号链接，root:root 0600。未输出实际凭据，未发送真实API请求；格式合理不能证明CAM授权有效。
- 原运行配置与暂存文件均先做加密补充包，另执行既有备份服务保存当前源码、数据库和runtime。下载到 D:/Backups/IdeaStage/v144-ses-20261106，ACL仅Administrators／SYSTEM；逐包比对SHA-256并用 C:/Users/Administrator/.ideastage-recovery/backup.key 完成AES-GCM认证解密，校验归档必要成员和凭据字段，不落明文文件。密钥与包分开保存。
- 合并前从已验证补充包读取原runtime和暂存文件，与服务器现值逐字节比对；持维护锁，仅合入6个邮件字段，冲突即拒绝，原其余字段保留。通过同目录0600临时文件、fsync和原子rename写回，未重启旧站。随后再次执行标准备份和补充备份，下载并解密复核；变更后备份中的6项邮件字段与暂存一致。

| 阶段／包 | 文件名 | 字节 | SHA-256 |
| --- | --- | ---: | --- |
| 变更前 | 2026-11-06T04-34-31-220Z-e6ca1642.isb | 6106176 | 656e95dbbfc6626364411095eeeda477ce2ad7a3aa1ab1a60efe3142236d9b4e |
| 变更前 | 2026-11-06-ses-before-config-8c3918de.isb | 1472 | ea782c91eeb5b2bd30165b4ef369e8f94155aebbdb1b189a97a8fd47b9a04b80 |
| 变更后 | 2026-11-06T04-37-03-319Z-929a11a7.isb | 6106130 | 5ce01e4f306741c60c36c2ec8336a58353499e7b0727f0da539fa4d0c1f6a33a |
| 变更后 | 2026-11-06-ses-after-config-96ef4c9c.isb | 1468 | 7b7d8d40a827f06d29842136884360c37225f4fd3aa15988231c5d34e8b169d9 |

本次副本核验为实际认证解密与成员检查，**未再次进行隔离数据库恢复，也未验证登录／正文恢复**；此前2026-11-04的空库恢复只作为历史证据，不能冒充本次完整恢复。后续受限入口和迁移前仍须刷新最新恢复点，并按执行单恢复验收。

### 新候选与旧站状态

精确候选通过依赖a209313的Git bundle传输，未push。bundle位于 D:/Backups/IdeaStage/v144-ses-20261106/candidate-33df487.bundle，SHA-256为516b6d6d6b9fbf24462a2e32c94560d649416184cbda6cd5794cd7f6db0ee7d6。

目标目录 /srv/ideastage/releases/33df4878d3a2a30b2e9621211410cfb4a6fd27ab：真实HEAD一致、Git工作区干净，npm ci --include=dev --ignore-scripts --no-audit --no-fund、生产build、npx tsc --noEmit、production-check.ts --env /etc/ideastage/runtime.env 均完成。目录root:ideastage 0750，其他用户无访问，仅.next/cache属网站账号。构建日志见附属目录v144-tencent-ses/20261106/target-build.log。

构建批处理末尾curl返回000／退出3，**不记录整批退出0**；随后通过独立SSH命令复核旧站health为200、ideastage.service为active。目标构建与配置检查的成功证据不受该末尾探测失败替代。正式current实际HEAD仍77c76768a6ad1d6a9bcc02389bfc08ba465b6345；runtime与暂存仍root:root 0600，备份服务Result=success、ExecMainStatus=0。

配置预检是离线校验，未证实邮件签名授权／投递。没有current切换、网站重启、正式迁移、恢复timer启用、实际邮件／模型调用或资金操作。#14仍未完成，下一步先补齐执行单第1节已有live模型／管理员配置，再落实受限入口与最新恢复点，然后受控迁移和切换；微信及真实收信按原执行单和#15继续，不重新索要已确认信息。

### 本轮独立审查

Standards：基准33df487之后的5份文档及2份新增证据，硬违规0／实质异味0；无秘密值入库，备份解密和数据库恢复边界、批处理失败与独立健康复核均如实记录。Spec：本轮遗漏0／范围蔓延0／确定性实现错误0；#14全票仍未完成，隔离恢复、受限入口、迁移切换、登录态与恢复调度继续待验，CAM与实际收信由#15核验。两轴均仅静态审查仓库记录，未独立重验服务器／备份，不替代真实环境证据。
