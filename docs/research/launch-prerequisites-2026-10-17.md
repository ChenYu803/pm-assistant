# 上线前置核查（2026-10-17）

范围仅限：Cloudflare 代理超时/流式响应、Ubuntu 24.04 的 MySQL 9.7.2 安装证据、Next.js 自托管与反向代理缓冲。本文不重跑 v1.41 replay，不执行模型，也不替代本机验收。

## 结论

购买服务器、连接服务器、安装数据库并配置 Cloudflare 后，网站具备“可部署”的基础条件，但不能据此承诺“配置完成即快速上线”。仍需在目标服务器完成构建、环境变量/密钥、数据库初始化与迁移、反向代理/TLS、健康检查和真实请求验收；长时间生成链路还受 Cloudflare 代理读超时及代理缓冲设置影响。

## 1. Cloudflare 524 与流式响应

Cloudflare 官方 524 文档说明：代理已连接源站，但源站未在默认 **125 秒** Proxy Read Timeout 内提供 HTTP 响应；持续超过该时限的请求可改为 DNS-only（不代理），或在满足条件时使用 Cache Rule 的 Proxy Read Timeout 设置。文档还说明 Enterprise 区域可提高该超时。[官方：Error 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)

部署判断：必须让长任务在 125 秒内先产生可被端到端转发的响应/心跳，或将这类接口放到不经普通 Cloudflare 代理的入口并单独保护。仅把服务器放到公网、打开 CDN 或修改 DNS，不能自动消除 524；反向代理和负载均衡器还必须保留流式分块，不得把心跳缓冲到请求结束后。

本轮对 Cloudflare 在线页面的 HTTP 抓取成功并提取到上述 125 秒文字；Cloudflare 页面内容与账户套餐/Cache Rule 可用性仍应以部署时控制台为准。

## 2. MySQL 9.7.2 与 Ubuntu 24.04

Oracle MySQL APT 仓库的 `noble` Release 文件列出 `mysql-9.7-lts` 组件；其 Ubuntu 24.04（`ubuntu24.04`）amd64 Packages 文件列出：

`Package: mysql-community-server`

`Version: 9.7.2-1ubuntu24.04`

`Filename: pool/mysql-9.7-lts/m/mysql-community/mysql-community-server_9.7.2-1ubuntu24.04_amd64.deb`

可追溯官方仓库文件：[noble Release](https://repo.mysql.com/apt/ubuntu/dists/noble/Release)、[mysql-9.7-lts amd64 Packages](https://repo.mysql.com/apt/ubuntu/dists/noble/mysql-9.7-lts/binary-amd64/Packages)。这证明仓库当前发布了对应 Ubuntu 24.04 的 9.7.2 deb 条目；实际安装仍需在目标机验证 APT 签名、依赖、架构、服务启动及 `SELECT VERSION()`。

本机事实另计：仓库脚本当前对服务器版本有 `9.7.2` 精确前缀检查（见 `scripts/verify-mysql-init.mjs`、`scripts/verify-v13-replay.mjs`）；本研究未修改这些检查，也未在目标云服务器安装。

## 3. Next.js 自托管

仓库 `package.json` 提供 `npm run build`（`next build`）和 `npm run start`（`next start`）。Next.js 自托管官方指南建议在 Next.js 前放置 nginx 等反向代理，以处理请求限制与安全边界；App Router 支持流式响应，但 nginx 或类似代理必须关闭 buffering，例如设置响应头 `X-Accel-Buffering: no`。负载均衡器需支持 chunked transfer encoding 或 HTTP/2 streaming，链路中其他反向代理也不得缓冲。[Next.js 官方自托管指南](https://nextjs.org/docs/app/guides/self-hosting)

部署判断：服务器准备好后可以采用 `npm ci`、`npm run build`、进程管理器运行 `npm run start`，再由 nginx/同类代理终止 TLS、转发域名并关闭流式接口缓冲。Cloudflare 代理若保留，必须把上述代理链路和 524 预算一起做真实长请求验收。

## 仍未证明的上线条件

- 目标服务器的 CPU、内存、磁盘、系统补丁、防火墙和备份策略。
- 生产环境密钥、数据库账号权限、初始化/迁移顺序及公网访问范围。
- nginx/Cloudflare/TLS 的实际配置，尤其是流式接口的首字节/心跳是否端到端可见。
- 真实域名下登录、写入、文件上传、长生成、取消和重启恢复。
