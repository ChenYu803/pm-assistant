# 中国大陆用户部署方案调研

调研日期：2026-09-23

## 结论摘要

产品用户绝大多数在中国大陆时，不建议把 Render 作为默认生产承载平台、再把应用连接到阿里云中国内地 MySQL。应用服务器与数据库跨境会增加数据库往返延迟，并把用户请求、应用和数据库之间的链路拆成跨境链路；这会影响登录后的动态页面、项目读取、聊天流和文件操作。

优先评估同区域的阿里云应用服务与阿里云 MySQL（例如 ECS/轻量应用服务器等 Node.js 可运行环境，加 RDS MySQL）。如果目标是稳定服务中国大陆用户，使用中国内地地域通常还要完成域名 ICP 备案，并核实产品、AI 服务、数据存储和网络出口的适用要求。Render 可作为海外临时 Demo 或海外测试环境，不应因部署方便就假定它适合大陆主用户。

Cloudflare CDN 只能对适合缓存的内容提供边缘分发，不能把 Render 的动态 Next.js 后端、数据库或 AI 请求迁移到中国大陆，也不能保证用户一定能访问 Render。Cloudflare 的中国网络是独立的企业级方案，存在申请、合同、备案等条件，不等于普通 Cloudflare 免费/Pro DNS 或代理自动覆盖中国大陆。

## 关键问题

### Render 应用 + 阿里云中国内地数据库

这会形成“大陆用户 → 海外 Render 应用 → 大陆阿里云数据库”的往返路径。数据库调用发生在服务端，用户浏览器不会直接连数据库，但每个动态请求都要等待应用服务器访问数据库。跨境 RTT、链路抖动或数据库公网访问策略都会增加延迟和故障点。数据库还必须允许 Render 出口地址访问；若 Render 出口地址不稳定或供应商防火墙白名单难以维护，连接会更脆弱。

不要仅凭“同一家供应商”判断连通性；阿里云数据库是否能从海外 Render 访问，需要核实实例地域、连接地址类型、公网访问、白名单/安全组和 TLS 要求。即使能连通，也不意味着体验适合大陆主用户。

### Cloudflare CDN 能否解决大陆无法访问 Render

普通 CDN 代理会把某些可缓存资源放到边缘节点，但动态页面、登录 Cookie、`/api/*`、SSE 聊天以及个性化数据库查询通常不能被当作静态文件缓存。若边缘节点仍需回源到 Render，用户到 Render 的动态回源链路仍然存在。

因此 Cloudflare 普通 CDN 可能改善静态资源加载，但不能承诺解决 Render 在大陆的连通性、动态 API、登录或 SSE 问题。Cloudflare 的 China Network 是另一个产品/服务等级，不应与普通橙云代理混为一谈；启用前必须向 Cloudflare 核实资格、合同、可用地区、备案条件和报价。

### 推荐的第一版路线

1. 先决定是否把“大陆用户能够稳定打开并完成核心流程”作为上线验收标准。根据用户分布，建议答案为是。
2. 评估阿里云中国内地 Node.js 承载平台 + 同地域 RDS MySQL。保持 Next.js 页面、API、认证 Cookie、SSE 在同一应用中，不拆前后端。
3. 如用中国内地云资源，先确认域名 ICP 备案、阿里云账号实名/主体要求，以及应用内容相关要求；备案完成前不应把正式域名指向内地网站服务。
4. 在 `AI_MODE=replay` 下先部署和验收网站/数据库链路。
5. 再评估 AI API 在服务器所在地区是否可访问、服务条款是否允许、费用和隐私处理；真实 AI 不可用时不能让核心网站整体不可用。
6. 若备案或内地部署暂时无法完成，可用 Render + 海外数据库做内部/海外试用，但必须把“大陆可能慢或无法稳定访问”标成已知限制，不能把 Cloudflare 普通 CDN 当成解决保证。

## 对当前仓库部署准备的影响

- `render.yaml` 和当前部署剧本表达的是海外 Demo 路线，不再应被当作面向大陆主用户的最终推荐。
- MySQL 版本、TLS 和迁移工具的云适配仍可复用，但数据库必须与应用尽量同地域部署。
- Cloudflare 应从当前第一阶段方案移除；只有确定域名、备案/产品资格和缓存策略后再评估。
- 不应现在就创建 Render 或阿里云资源；先确认目标市场、域名/备案状态、阿里云账号主体和目标服务地域。

## 官方资料

以下为需要在实际采购/开通前再次核对的官方入口。产品区域、计划、资格和监管要求可能变化。

- Render Regions: https://render.com/docs/regions
- Render Static Sites: https://render.com/docs/static-sites （静态站与动态 Web Service 的区别）
- Cloudflare Cache: https://developers.cloudflare.com/cache/ （缓存命中与回源概念）
- Cloudflare China Network: https://developers.cloudflare.com/china-network/ （独立中国网络服务及要求）
- 阿里云 ICP 备案帮助中心: https://beian.aliyun.com/ （中国内地服务器域名备案流程）
- 阿里云 RDS MySQL 产品文档: https://help.aliyun.com/product/26090.html
- 阿里云 RDS 公网连接说明: https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/connect-to-an-apsaradb-rds-for-mysql-instance-over-the-internet

## 尚需核实

- 用户现有域名、注册商、ICP备案状态及备案主体。
- 阿里云账号是否完成实名、主体是个人还是企业。
- 阿里云可选 Node.js 托管产品的当前地域、运行时、费用和长连接/SSE限制。
- 目标 RDS MySQL 实例版本、TLS CA、外网地址、白名单、迁移权限和同地域方案。
- 真实 AI 服务从选定大陆服务器地域的可达性、服务条款和数据合规要求。
- Cloudflare China Network 当前的申请主体、ICP 和商业计划门槛；不能仅根据普通 Cloudflare 文档推断已具备资格。
