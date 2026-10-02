# v1.42：海外单机 MySQL 与 Cloudflare 路线复评

日期：2026-10-02。用途：个人面试作品、少量免费试用；主要用户在中国大陆。本文只提供决策依据，没有购买或部署。朋友没有提供商家、机房和套餐，因此其“很快”只能作为试验方向，不能当成可复制的速度承诺。

## 结论

一台海外 VPS 同时运行 Next.js 和现有 MySQL，外部接 Cloudflare，是合理的小规模上线方案。它省去 PostgreSQL 迁移与独立云数据库费用，但增加服务器维护和异机备份工作。大陆访问的优劣取决于实际运营商、机房线路、时段、Cloudflare 路由和动态请求，不能按国家简单排序，也没有未经测量就可信的固定毫秒数。

## Cloudflare 到底做什么

开启 DNS 记录的橙云代理后，访问链路是“用户 → Cloudflare → 源服务器”。灰云 DNS-only 只解析域名，HTTP 请求直接到源服务器。[官方代理说明](https://developers.cloudflare.com/dns/proxy-status/)

CDN 可以缓存符合规则的图片、JS、CSS 等静态资源。命中缓存时无需再去美国取文件；缓存未命中、登录、聊天、保存项目仍需要回源。Cloudflare 默认不缓存 HTML、JSON 和非 GET 请求；不要把整个登录网站配置成 Cache Everything。[官方缓存规则](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)

普通全球网络使用 Anycast 路由，不保证进入地理最近节点，因此“美国服务器 + Cloudflare 固定香港分发”不是普通 Free 套餐的承诺。朋友可能在其网络下进入香港，也可能用了其他配置，现有信息无法判断。[官方地理路由说明](https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/geographic-traffic-routing/)

Cloudflare 中国大陆节点属于独立 China Network，需要 Enterprise 订阅及域名有效 ICP 备案，不是免费 CDN 的一部分。[官方 China Network](https://developers.cloudflare.com/china-network/)

## 三条可实施路线

| 路线 | 实施方式 | 大陆访问判断 |
|---|---|---|
| A：美国 VPS + 同机 MySQL + Cloudflare Free | 选小额可短期付费的 VPS，安装应用与数据库，接入域名橙云，缓存静态资源 | 值得以朋友体验为方向试验；动态请求仍去美国，不能承诺稳定或固定香港入口 |
| B：同一台美国 VPS 直接访问 | 灰云 DNS-only，应用同机数据库，服务器自行提供可信 HTTPS | 不经 Cloudflare，避免其代理读超时；可能更快也可能更慢，是 A 的低成本对照组 |
| C：香港、日本或新加坡等亚洲 VPS + 同机 MySQL | 看大陆线路实测，不只看地理距离；先直连，必要时再比较橙云 | 好的跨境线路可能缩短动态往返；廉价拥堵线路也可能更差，依旧需要不同运营商和晚高峰实测 |

以上属于方案推断，不是已完成的网络测试。没有提供商/配置/实时价格，本文不虚构报价。先短期试用，验收后再考虑年付。

共同部署路径：申请 VPS → 安装受支持 Linux、Node、MySQL → 初始化全新云端库并部署生产构建 → 用 Caddy 或 Nginx 配置 HTTPS 与进程守护 → 域名在阿里云注册，DNS 可交给 Cloudflare → 数据库仅监听本机或内部容器网络，不公开 3306 → 设置每日备份并复制到另一位置。橙云使用 Full (strict)，源站也配置有效证书；灰云直连需要浏览器信任的证书，不能仅依赖 Cloudflare Origin CA。[Full (strict) 官方说明](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)

同机 MySQL 的容量来自 VPS 磁盘，不再受 Supabase Free 的 500 MB 或闲置暂停限制，但应用与数据库共享内存、CPU，单机故障会同时影响两者。不要把备份只放在原服务器。

## 项目已有的长请求需要先解决

代码核查：`src/app/api/iterations/[id]/stages/[stage]/sessions/[sessionId]/messages/route.ts` POST 先 await `generateMysqlIterationMessage`，然后返回 JSON；`src/lib/mysql-iteration-workbench.ts:382` 的 AI 超时为 `600_000` 毫秒，流式内容目前在服务端累加后一次返回。旧标签页 `src/lib/mysql-chat.ts` 存在 SSE，不代表当前工作台也已经对浏览器流式输出。

Cloudflare 当前默认 Proxy Read Timeout 是 **125 秒**，超时返回 524；常见旧资料写的 100 或 120 秒不适用于本次核查。免费套餐不能随意提高该限制。官方建议长任务改为状态轮询或放在 DNS-only 子域名。[连接限制](https://developers.cloudflare.com/fundamentals/reference/connection-limits/)、[524 排查](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)

因此美国 VPS 解除 Vercel 函数上限，并不自动解决 Cloudflare 长请求问题。上线实施时优先评估异步任务 + 轮询，或真实 SSE 持续发送进度/心跳并关闭反向代理缓冲；SSE 不是“总时长无限”，仍需保证首包及时且无长时间静默，并以实际链路验证。最快验证现有版本可先用整站 DNS-only，避免拆分 API 域名引入 Cookie/CORS 复杂性。

## 大陆验收建议

关闭 VPN/代理，使用真实大陆网络对照 A/B：至少家庭宽带、手机移动网络，尽量覆盖不同运营商；下午和晚高峰分别测首页、静态资源、登录、创建项目、保存/刷新、文件下载，以及一条超过两分钟的真实生成。记录失败率、页面可操作时间、普通 API 延迟和生成完成率；AI 思考时间与网络耗时分开看。响应 `cf-ray` 可确认经 Cloudflare 与该次处理节点，但一次 HKG 不代表未来固定香港。[Cloudflare 慢站排查](https://developers.cloudflare.com/speed/troubleshooting/slow-website/)

建议先保留 MySQL，用一台低成本海外 VPS 完成真实链路试验，再决定正式开启橙云还是灰云。若美国路线实测不达标，按预算寻找亚洲机房的大陆线路对照，避免同时换托管平台与数据库扩大本轮工作量。
