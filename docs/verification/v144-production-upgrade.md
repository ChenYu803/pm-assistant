# v1.44 #14 目标机升级准备与阻断记录

2026-11-04，Asia/Shanghai。**升级准备已完成，缺少真实邮件配置，尚未切换版本；不是受控验收就绪。** #14 为 needs-info，#15 尚未开始。结构化证据见 [summary.json](v144-production-upgrade/summary.json)。

## 实际版本与范围

实施及审查基准为 fceab8328fd12386d8aa013c4f94ac3ee5b9dd85，开始时工作区干净，分支 codex-pm-assistant-v1.1-docs。#13 指定候选为 a20931375da54551ee348dfa983a5271830c31ad，已核验 v1.43 的 fd6fb2c、5d2d562 及 v1.44 的 aaffb62 为候选祖先；[发布差集](v144-production-upgrade/release-diff.txt)依据提交比较。

经目标机 git ls-remote 核实远端分支仍为77c76768a6ad1d6a9bcc02389bfc08ba465b6345。本机直连GitHub超时；未以失败推断远端版本。服务器101.33.79.30的current指向 /srv/ideastage/releases/77c7678a6ad1d6a9bc02389bfc08ba465b6345，实际HEAD仍77c7676，目录名与提交存在历史差异。用户调用implement授权本票准备及部署，推送仍须单独确认。本次以依赖旧提交的Git bundle传输精确候选，未push。

## 安全副本与实际恢复

北京时间20:04执行既有备份服务，保存旧源码、runtime和正式数据库。另以既有密钥加密维护配置、网站和备份systemd单元、nginx站点及代理配置，弥补标准备份不含维护配置的边界。本次没有生成或轮换凭据。

本机目录 D:/Backups/IdeaStage/v144-upgrade-20261104 已限制ACL为Administrators/SYSTEM，实际下载并核对：

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| 2026-11-04T12-04-21-958Z-06ef9e0c.isb | 6106978 | e470da48859ce9fb821592296138c5ae2527d21c96ae8b754acc048ee92e9185 |
| 2026-11-04-v144-before-system-config.isb | 3186 | d474effcb3781ed2012ffad3548e7b1f61dc03b6badda5bb929911420fd7edf0 |
| candidate-a209313.bundle | 21281128 | ed31097a842afad776ec1ca104e2d88362712b6406968c2e06dbace4d942dbbc |

现有32字节密钥复制到独立受限目录 C:/Users/Administrator/.ideastage-recovery/backup.key，与备份包分开保存。两份下载包均使用本机密钥通过AES-GCM认证解密，归档成员已核对，验收产生的明文压缩包已删除。既有KeePass条目保留，本轮未解锁，不宣称从KeePass恢复。SSH私钥第二份副本及独立网盘上传未核验。

本机MySQL9.7.2以production-backup的restore-test实际恢复随机库ideastage_restore_a918b465b06c974d：22张表、22条迁移，账号/项目/文件及其余业务表均0，与目标机一致。演练库、临时维护配置已清理，日常库和正式库未覆盖。**空快照没有可登录账号或正文，不能声称登录、项目、正文恢复已通过。**

目标机旧MYSQL_ADMIN凭据返回ER_ACCESS_DENIED_ERROR，MYSQL_MIGRATION可连接，身份ideastage_migration@localhost。没有猜密码或重设权限；目标机后续隔离恢复需要从独立保存处找回有效管理员凭据。本轮恢复使用本机管理员。

## 候选与验证

候选位于 /srv/ideastage/releases/a20931375da54551ee348dfa983a5271830c31ad，真实HEAD精确一致，工作区干净。npm ci --include=dev、生产构建、tsc通过；发行目录root:ideastage 0750，移除组写和其他用户权限，仅.next/cache归网站账号。见[构建日志](v144-production-upgrade/target-build.log)。未扩容或切换平台。

本机tsc通过。附加旧verify-v142-production-tools.mjs为**2通过、1失败**：其附带旧AI入口缺少生成操作标识，requests=0/externalRequests=0，未进入备份断言，随机库/账号及夹具已清理。未修改断言或将其列为通过。见[日志](v144-production-upgrade/backup-tools.log)与[明细](v144-production-upgrade/backup-tools-detail.json)。本轮直接执行的生产包解密、实际恢复结果独立有效，不等于旧专项通过；#13原回归证据保持原样。

20:13候选使用真实runtime.env离线预检返回1：

~~~text
❌ RESEND_API_KEY 需替换为至少 16 位随机值
❌ EMAIL_FROM 需为事务邮件服务已验证的发信身份
~~~

见[预检](v144-production-upgrade/target-preflight.log)与[目标机状态](v144-production-upgrade/target-preparation.json)。service的ExecStartPre调用同一检查，所以真实邮件配置是#14实际启动阻断。#15负责收信验收，不能据此跳过#14启动条件。

## 配置与未完成范围

| 项目 | 本轮事实 |
|---|---|
| 模型 | 服务器仍replay，密钥为空，模型deepseek-v4-flash；本机已有官方https://api.deepseek.com配置，后续安全注入live，真实计量交#15 |
| 邮件 | 服务器及本机均缺RESEND_API_KEY、EMAIL_FROM，需要运营者私下填写真实值 |
| 管理员 | 沿用3037116719@qq.com，服务器白名单未配置、正式库无对应账号，不声称已可登录 |
| 微信 | RECHARGE_WECHAT_CONTACT缺失，真实渠道交#15，期间联系充值保持未开放 |
| 测试配置 | 未配置邮件替身、测试时钟或伪用量 |
| 迁移 | 正式库仍0001–0022，0023–0032待执行，未运行db:init或修改账号验证事实 |
| 受限入口 | 尚未激活；候选未接入公网，当前在线仍旧站 |
| 恢复调度 | 文件已在候选中，未安装或启用，尚无目标机运行证据 |

后续按[本次执行单](../v144-production-upgrade-runbook.md)继续：真实邮件字段就绪、预检通过后，保存配置副本，落实受限入口、暂停写入，刷新备份及恢复验收，再迁移和切换。当前无正式库迁移、current切换、恢复调度、登录态基础验收、真实模型请求或资金操作，旧站active、health200；不作受控验收就绪或正式发布结论。

失败恢复必须保护升级后新增资金事实：先受限和暂停写入/恢复任务，保存当前库及服务器外副本；旧备份只恢复到新隔离库，优先在增量库上修正前进。旧代码与当前结构及资金约束兼容性未经验证时不切回，更不能覆盖旧库丢弃新积分、充值、退款或审计。基础验收完成后刷新安全副本并记录timer运行，才可resolved并交#15。

双轴审查已完成：规范违反0、实现缺陷0、范围蔓延0；规格仍有外部启动阻断与未完成验收两类，不代表通过发布。见[审查记录](v144-production-upgrade/review.md)。20:20再次确认旧站和备份timer仍active、health200，见[最终目标机状态](v144-production-upgrade/final-target-state.json)。
