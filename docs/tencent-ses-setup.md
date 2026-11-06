# 腾讯云 SES 验证码邮件接入

2026-11-05。用户在讨论发信成本和供应商选择后决定优先采用腾讯云 SES，替换此前代码中的 Resend。以下控制台进度来自用户反馈，尚未通过网站真实发信核验。

## 已准备的信息

| 项目 | 值／状态 |
| --- | --- |
| 地域 | 广州，API 地域 ap-guangzhou |
| 发信域名 | mail.ideastage.top，用户确认验证通过 |
| 发信地址 | noreply@mail.ideastage.top，用户确认已创建 |
| 注册模板 | 68248，用户确认审核通过 |
| 找回密码模板 | 68249，用户确认审核通过 |
| 模板变量 | code；模板正文使用 {{code}}，程序填入本次验证码 |
| 专用子用户 | 按 ideastage-email 的步骤创建；用户确认子用户及密钥已创建并保存 |
| 授权目标 | 仅 SendEmail；实际策略内容仍需后续核实，不能把指导步骤当作授权证据 |
| 密钥副本 | 用户确认已保存；沿用本次指导的 KeePass 保存方式，不在聊天／Git 存真实值 |

## 私下填写凭据

服务器已创建 /etc/ideastage/email-ses.env，root:root、0600，独立于网站当前读取的 runtime.env。地域、模板和发信地址已预填，仅 SecretId 与 SecretKey 留空。该文件尚未加载，当前旧站继续运行。

用户在已有服务器 SSH 终端执行：

~~~bash
sudo nano /etc/ideastage/email-ses.env
~~~

仅将 KeePass 中的 SecretId、SecretKey 分别填入 TENCENT_SES_SECRET_ID、TENCENT_SES_SECRET_KEY 的等号后，保留其他字段。Ctrl+O、回车保存，Ctrl+X 退出。不要粘贴整个文件到聊天，不使用会把密钥写进命令历史的 echo 命令。凭据按环境文件语法填写，腾讯云密钥通常无需引号；不附加空格。

完成后代理仅报告字段齐备性及文件权限，不输出值。保存成功不等于授权有效、模板可用或邮件实际送达。若填错可再次编辑；原值从 KeePass 找回，不需重建子用户。

## 接入和部署边界

- 使用腾讯云官方单产品 Node.js SDK，锁定 tencentcloud-sdk-nodejs-ses 4.1.271；固定官方端点，不提供任意邮件端点覆盖。
- SendEmail 选择对应用途的 TemplateID，通过 TemplateData 的 code 变量填充，TriggerType=1，每次只有一个收件人，超时 15 秒。服务商响应需包含 MessageId，不自动重发。
- 生产门禁和实际发信共用 tencent-ses-config.ts 验证；不再要求或使用 RESEND_API_KEY。旧 Resend 凭据不在本轮自动删除／吊销。
- 隔离测试清除 TENCENT_SES_*、EMAIL_FROM 和旧 RESEND_API_KEY；邮件替身与生产禁用规则保持原样。离线 SDK 边界通过不代表真实送达。
- a209313 是此前 #13 的候选，不含本次邮件接入。必须把本轮已提交补丁纳入新精确候选，重做目标机构建、离线门禁并记录实际发布提交，不能沿用旧目录的通过结论。
- 合并配置前刷新原 runtime.env 的加密及服务器外副本。将已核实的 SES 字段合入保留其余配置的 runtime.env，变更后再次备份；待配置文件需纳入受限加密补充包或在核实合入且安全副本可读取后清理，不能遗漏新增凭据。
- 不因暂存凭据就切换 current、迁移数据库或重启服务。#14 仍需按升级执行单完成受控升级；#15 验收真实注册、找回收信、实际权限／限额及正式开放。

完整字段见 .env.example，真实密钥只在受限配置和密码管理器中保存。

## 2026-11-06 实际状态

两项凭据已在服务器通过仅状态核验，6项邮件字段已在变更前后加密备份的保护下原子合入runtime.env，其他字段保留，runtime与暂存均root:root 0600。服务器外备份在 D:/Backups/IdeaStage/v144-ses-20261106，实际SHA-256及AES-GCM解密检查通过；备份密钥仍独立保管，未落明文。暂存文件保留用于后续核对，已纳入补充加密包。

新候选33df4878d3a2a30b2e9621211410cfb4a6fd27ab的目标机构建／tsc／离线配置门禁已通过，旧站未重启且current未切换。这里只完成配置准备，不代表真实发信授权或收信通过。下一步先补齐升级执行单第1节已有live模型／管理员配置，再落实受限入口、刷新备份并恢复验收，之后迁移切换。详细证据见 verification/v144-tencent-ses.md 的2026-11-06章节。
