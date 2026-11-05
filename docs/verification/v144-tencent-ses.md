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
