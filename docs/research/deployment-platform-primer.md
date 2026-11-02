# 部署平台与低成本路线扫盲

日期：2026-09-23

## 先分清四样东西

| 名词 | 大白话 | 负责什么 |
|---|---|---|
| Vercel / Render | 托管平台，像帮你打理店面的物业 | 从代码仓库构建并运行网站，平台替你处理一部分部署和机器维护 |
| VPS | 虚拟服务器，像租一间空店面 | 给你一台可控制的电脑；操作系统、安装、更新、防火墙、备份等大多要自己管 |
| 数据库 | 仓库 | 保存用户、项目、聊天和文件；通常要单独选购和配置 |
| Cloudflare CDN/代理 | 网站前面的网络入口和缓存点 | 可代理请求、缓存适合缓存的静态内容；动态请求通常仍要回源到应用服务器 |

## Vercel 与 Render

| 对比 | Vercel | Render |
|---|---|---|
| 擅长 | Next.js 和前端部署体验；连接 Git 后自动构建、预览，静态资源分发方便 | 更通用的托管；可以运行持续在线的 Node.js Web Service、后台服务等 |
| 程序怎么运行 | 静态内容由 CDN 提供；动态逻辑常由 Functions 按请求执行，时长、区域和资源受计划/配置限制 | Web Service 以持续运行的服务进程工作，指定区域；免费实例可能休眠，具体按当前计划核对 |
| 数据库 | 通常另选数据库；扩缩容时注意函数实例与数据库连接数 | 通常另选数据库；服务和数据库最好靠近，Render 私网只解决同平台同区域服务间通信 |
| 对本项目的意义 | Next.js 支持自然，但本项目的 MySQL、认证和 SSE 长聊天需要检查函数时长与连接池；不是不能用，必要时可改代码 | 整个 Next.js 单体作为一个 Node 服务较直接；但“常驻 Node”不代表单个 HTTP 请求可无限运行，仍要检查平台请求超时、SSE 行为和数据库连接限制 |
| 适合谁 | 想少管部署细节，主要用 Next.js，希望快速预览版本 | 想把网站当一个常驻 Node 服务运行，或还要部署一般后端服务 |

这两个是“托管方式”的区别，不是“中国访问速度”的保证。它们的可用区域都不等于中国大陆；要判断大陆用户体验，必须测具体网络和真实业务流程。

## Cloudflare 所谓“分发到日本/香港”是什么

普通 Cloudflare 代理可能让浏览器先连到一个 Cloudflare 网络入口；Cloudflare 根据网络路由接入其网络。若静态文件已经缓存，边缘节点可直接返回；若是登录、读数据库、写文件、调用 AI 或聊天 SSE，通常仍要把请求交给源站服务器处理。

因此，“请求经过日本/香港附近的 Cloudflare 节点”不等于“整个网站服务器和数据库复制到了日本/香港”。也不一定每个大陆运营商都走同一条路。你朋友已经在目标用户网络上验证过，这是很有价值的实际证据；下一步要弄清其测试覆盖了首页还是完整产品流程，并用同样方式验证本产品。

Cloudflare 的 China Network 是另一项企业级服务，不是普通 DNS 或开橙云自动包含的大陆 CDN。其官方准入资料列出 Enterprise、单独订阅、ICP 文件/许可等要求。

## 不买昂贵大陆云时的路线

| 路线 | 成本倾向 | 你要自己承担的事 | 适用情况 |
|---|---|---|---|
| **朋友已验证：美国源站 + Cloudflare 普通代理/CDN** | 低到中，取决于源站和数据库 | 测大陆运营商、保证动态 API/SSE 和数据库路径可用；若源站是 VPS，还要维护系统 | 优先候选。先找第一位用户、成本重要、可以接受用目标用户实测决定 |
| **Vercel + 外部数据库** | 入门可低；总价取决于函数用量和数据库 | 处理函数时限、连接数、真实 AI 长请求限制 | 想快速部署 Next.js，且确认动态工作负载符合计划限制 |
| **Render + 外部数据库** | 入门可低；免费服务可能休眠 | 处理海外到用户/数据库链路及计划限制 | 想用长驻 Node 服务，接受 Render 没有大陆区 |
| **美国 VPS + 同区 MySQL** | 常见的低月费路线 | Linux 更新、防火墙、备份、故障恢复、监控、证书和部署几乎都要自己负责 | 想压低固定成本且愿意学习/承担运维 |
| **香港/新加坡 VPS 或托管服务 + 同区数据库** | 价格按供应商而变，未必比美国低 | 仍需实测运营商路由；VPS 仍要运维 | 想把服务器放近一些，但暂不使用中国内地资源 |
| **中国内地应用 + 同区数据库** | 不一定天然很贵；要按套餐和流量核算 | ICP/主体/内容等接入要求和国内云管理 | 大陆稳定性是硬指标时评估 |
| **Cloudflare China Network** | 企业级成本与流程 | 企业资格、ICP、合同、内容审核和产品接入 | 有规模/预算且确有大陆 CDN 或动态跨境加速需求 |

这里的“低/中/企业级”只是相对投入，不是报价。供应商价格会变，建库、流量、备份和 AI 调用也会形成额外费用；采购前要按实际套餐核价。

## 给当前 Demo 的选择建议

1. **先把朋友的方案作为第一候选。** 不必现在改投昂贵大陆云，也不必认定 Render/Vercel 必须采用。
2. 取得朋友方案的非秘密信息：源站服务商和地区、数据库地区、Cloudflare 使用普通代理还是其他加速产品、实际测试的大陆地区/运营商。
3. 用本产品在相同网络下测完整流程：打开、注册、登录、创建项目、保存文件、刷新读取、聊天 SSE 连续完成。只测首页不足以验证产品。
4. 第一版尽量让应用和数据库同区域；不要默认美国应用连接中国内地数据库。页面/API/认证仍保持同源，不必为了 CDN 把应用拆成前后端。
5. 测试结果够用就先找用户；只有实测证明线路成为障碍，才比较香港/新加坡或内地方案。这样避免提前为尚未出现的问题增加架构和费用。

## 官方资料

- [Vercel Functions](https://vercel.com/docs/functions)：Vercel 动态逻辑的运行方式。
- [Vercel Function Duration](https://vercel.com/docs/functions/configuring-functions/duration)：函数最大运行时长依计划/配置而定；部署前核对当前值。
- [Vercel Regions](https://vercel.com/docs/regions)：函数运行区域。
- [Render Web Services](https://render.com/docs/web-services)：Node Web Service 部署和运行方式。
- [Render Regions](https://render.com/docs/regions)：Render 当前区域列表。
- [Render Free](https://render.com/docs/free)：免费服务限制和休眠行为，以当前说明为准。
- [Cloudflare Proxy Status](https://developers.cloudflare.com/dns/proxy-status/)：代理 DNS 如何让 HTTP/HTTPS 请求经 Cloudflare 到源站。
- [Cloudflare Cache](https://developers.cloudflare.com/cache/)：缓存概念及配置。
- [Cloudflare China Network](https://developers.cloudflare.com/china-network/) 和[开通要求](https://developers.cloudflare.com/china-network/get-started/)：中国网络的独立产品和资格要求。

中国大陆访问、ICP 和具体业务适用要求请结合域名、服务地区、服务内容和主体向服务商核实；本文件不是法律意见。更详细的 Render、阿里云 RDS 与 Cloudflare 链路审查见同目录 `china-mainland-render-alibaba-cloudflare.md`。
