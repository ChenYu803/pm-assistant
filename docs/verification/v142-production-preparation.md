# v1.42 #02 生产准备验收

日期：2026-10-18。范围：不依赖购买服务器或 DNS/Cloudflare 配置的代码、模板、部署运行手册与隔离测试。真实香港主机未连接，不迁移/写入日常数据库，不调用真实模型，不推送。

## 已实现

- 邀请码在注册服务端校验；生产默认邀请模式，客户端只接收是否必填，不接收秘密。账号/全站真实 AI 请求默认 10/100 次，每日北京时间重置，以 MySQL 事务原子占用、重启保留；replay 不计，失败/停止不退回，SDK 不隐式重试。
- 生产配置离线预检、版本/迁移检查、公开无敏感字段的健康接口；单实例 systemd 启动前收口遗留新/旧生成与操作锁，已成功内容/候选/快照保留。
- 新工作台流式沿用 #01；旧聊天增加 15 秒心跳/禁缓存和断线取消。润色增加心跳与结果 SSE，保留旧 JSON，UI 仍完整预览→显式应用草稿→显式保存，不隐式写正式文件。
- Ubuntu systemd、nginx HTTP/HTTPS/SSE、证书续期、首次部署/更新/回退/Cloudflare 运行手册。网站账号只可写缓存，维护凭据/备份密钥外置。
- MySQL 事务导出 + Git 源码归档 + 配置/元数据，AES-256-GCM 加密和 SHA-256，成功后原子更新 latest。Windows 严格 SSH/时效/哈希拉取；随机独立库恢复与新私有目录 extract，拒绝覆盖。
- Next/eslint-config-next 16.3.0 → 16.3.8，同系列修复补丁；兼容更新 sharp、nanoid、source-map-js、brace-expansion、js-yaml。生产 audit 为 0 项。完整 audit 剩 5 个 high 条目来自开发 lint 的 braces→micromatch→fast-glob→Next ESLint 链，无当前同系列修复；不执行 force 降级至 Next 14，不宣称全部依赖零风险。网站请求不加载该 lint 工具链。

## 验证记录

| 检查 | 结果与证据 |
|---|---|
| 生产工具隔离专项 | 51/51；`C:/Users/Administrator/AppData/Local/Temp/v142-production-tools-evidence-nCBilc/summary.json`，日志 tool.log |
| 生产准备与润色/旧聊天专项 | 59/59（业务 52，环境 7）；`C:/Users/Administrator/AppData/Local/Temp/v141-production-preparation-x3cuyo/summary.json`，桌面/390px 手机注册截图及润色错误截图已检查 |
| 新工作台流式相邻回归 | 23/23；`C:/Users/Administrator/AppData/Local/Temp/v141-generation-stream-LcjOmn/summary.json` |
| 生产构建、TypeScript、定向 lint | `npm run build`（Next 16.3.8）、`npx tsc --noEmit`、本轮所有业务/工具/验证脚本的定向 ESLint、`git diff --check` 通过 |
| UI detector | Impeccable 对注册表单/页面与文件编辑器返回 `[]` |
| 部署手册命令语法 | 10 个 bash 块以 Git Bash `bash -n` 检查通过；不是 Linux 执行证明 |
| 生产依赖审计 | `npm audit --omit=dev --json` 为 0 项；证据为工具目录中的 production-audit.json |

工具专项实际运行本机 MySQL 9.7.2 的 mysqldump/mysql、Git archive、tar、加解密、随机库恢复；比较原始与恢复账号/额度/表计数，验证篡改（含重算外层 SHA）、错密钥、已有输出、失败不刷新成功标志。Windows PowerShell 5.1 与 pwsh 分别执行真实拉取脚本、mock scp 的 9 项语法/成功/重复/过期/篡改/下载失败/非法索引/同名冲突/临时清理检查；mock 不证明真实 SSH 或计划任务已安装。

供应商边界使用独立子进程 `AI_MODE=live` 连接 **127.0.0.1 模拟 HTTP 服务**，9 项检查、实际 5 次本机请求、真实外部请求 0；验证 Stream/Completion 共享原子限额、缺账号/超额不访问供应商、八并发仅两次送达、HTTP 500 不重试且占次数。这是实际 SDK 与限额接线证明，不是 DeepSeek 可用性/质量或费用实测。

旧聊天断线通过真实 HTTP SSE 取消验证部分正文/中断/锁释放及新请求重试；心跳协议使用正式函数和隔离库，将测试进程的 15 秒定时器缩为 20ms，断言实际注册周期与 data/type 事件，结束时等待数据库收口再关测试池。这不证明代理链路的真实 15 秒转发。

所有随机测试库、应用账号、恢复库、隔离服务、含密钥/明文的工具临时夹具已清理；证据目录保留脱敏摘要和截图。

## 部署后仍必须验收

按 [Ubuntu 部署运行手册](../deploy-ubuntu-production.md) 第 10 节执行：真实版本/磁盘/端口、nginx/systemd 配置加载、HTTPS cookie 与证书续期、真实域名邀请登录/数据隔离/写入/重启、真实模型短调用和长生成、Cloudflare 无缓冲/无认证缓存/真实来源限流、实际 Windows/网盘拉取及恢复后的登录数据。

当前没有 Linux 服务加载或真实 Cloudflare 证据，没有并发容量承诺。共享邀请码可转发，次数不是金额硬上限；备份保留按手册人工维护，没有自动网盘上传/自动删包/桌面告警。服务器备份成功不等于已形成每日异地副本，电脑关机/未上传会扩大恢复时间窗。
