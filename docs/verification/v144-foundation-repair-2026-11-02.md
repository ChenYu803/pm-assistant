# v1.44 #01 基础回归修复验收（2026-11-02）

用户先授权提交整个工作区，再正式修复上个上下文交接的问题。修复前检查点为 `1e5f529`，保存原有 399 个文件改动；本轮后续改动只涉及测试与验收记录，正式产品代码无增量。

## 问题与修复

[前一轮真实性核验](v144-foundation-diagnosis-2026-11-02.md) 已证明旧入口定位和 SSE/JSON 混用导致基础回放失败。本轮在原场景中集中修复，不替换为简化场景：

1. 三处“开始本阶段工作”定位同步为当前入口“新建会话，开始这一阶段”，使用精确可访问名称。沿用现有移动区域导航。
2. 普通 CRUD 继续使用 JSON mutation；消息发送通过浏览器 fetch 响应副本观察 SSE。观察器保留请求参数和原响应，产品仍按原路径消费正文。正常回复必须包含非空 token、唯一 result、业务状态 200 和已完成消息，并等待界面退出生成状态；后续继续核对 API 与数据库。
3. 停止请求仍按 JSON 验收；原消息流必须为 HTTP 200，唯一 result 必须为业务状态 409 且错误为“生成已停止”。之后等待停止按钮消失和服务端生成事实清除，再验证失败/已停止消息以及会话隔离。

此前的困难在于流的连接状态、业务结果、页面状态和数据库结果分属不同时间点。用 JSON 解析或单看 HTTP 状态会误判；Playwright 的 SSE response.finished() 也有既有等待陷阱。本轮直接观察真实浏览器响应副本，并同时保留页面与持久事实验收。产品协议与 UI 无需为旧测试改变。

## 验证结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 完整基础回放 | **101 通过、0 失败**；内部场景 94/94，1440×900、390×844 两条完整流程 | [launcher](v144-foundation-repair/foundation-summary.json)、[场景与全部断言](v144-foundation-repair/foundation-scenario-summary.json) |
| 相邻流式专项 | **23 通过、0 失败**；内部场景 16/16，6 流程 | [launcher](v144-foundation-repair/stream-summary.json)、[场景](v144-foundation-repair/stream-scenario-summary.json) |
| 观察器协议检查 | **12 通过、0 失败** | `node scripts/verify-foundation-stream-observer-contract.mjs` |
| TypeScript / 语法 / 定向 ESLint / diff | 全部通过 | 下列命令 |
| 原有断言与改动范围 | 既有模板断言调用点 38 个均保留，新增 2 个调用点；正式 src 无变更 | [范围核对](v144-foundation-repair/scope-audit.json) |

launcher 数字已包含内部场景，不能相加。范围核对的调用点统计也不是运行断言数；同一调用点会在不同阶段或设备重复执行。

基础回放完整覆盖注册、退出、重新登录、项目和迭代创建/改名、四环软门禁、空导航零副作用、零文件完成阶段和重开、显式会话创建、正常回复、停止生成、上下文/消息/草稿隔离、跨迭代共享项目文件、数据库事实及无横向溢出/浏览器运行错误。没有删除原有业务断言。

观察器检查通过逐字节分块、组合 Unicode、CRLF、多行 data，验证不改请求/响应和产品正文；反例要求旧 HTTP 409、JSON 冒充 SSE、只有 token 无 result、重复 result、错误业务状态、非停止错误、损坏 JSON 和截断事件均失败。首轮离线检查的 VM 环境缺少 URL 全局，补齐标准环境后 12 项全部通过；未因此修改正式流协议。

复现与检查命令：

```powershell
$env:AI_MODE='replay'
npx tsx scripts/verify-v141-replay-foundation.mjs
npx tsx scripts/verify-v142-generation-stream.mjs
node scripts/verify-foundation-stream-observer-contract.mjs
npx tsc --noEmit
node --check scripts/verify-foundation-stream-observer.mjs
node --check scripts/verify-foundation-stream-observer-contract.mjs
node --check scripts/verify-v141-replay-foundation-scenario.mjs
npx eslint scripts/verify-foundation-stream-observer.mjs scripts/verify-foundation-stream-observer-contract.mjs scripts/verify-v141-replay-foundation-scenario.mjs
git diff --check
```

## 证据与边界

两套 launcher 均确认固定 replay、从随机隔离空库开始，并回收测试账号、数据库与源码副本；两份 summary 均为 `cleaned: true`。未调用真实模型，未操作日常或生产库，未 push、部署或开展后续票。测试-only 修改不重复构建产品；上述结果不代替检查点中既有视觉/部署改动的生产发布验收。

基础回放六张浏览器截图随证据保存：

- [桌面空阶段导航](v144-foundation-repair/foundation-1440-empty-navigation.png)、[桌面会话隔离](v144-foundation-repair/foundation-1440-sessions.png)、[桌面共享文件](v144-foundation-repair/foundation-1440-shared-files.png)。
- [手机空阶段导航](v144-foundation-repair/foundation-390-empty-navigation.png)、[手机会话隔离](v144-foundation-repair/foundation-390-sessions.png)、[手机共享文件](v144-foundation-repair/foundation-390-shared-files.png)。

原始运行目录由两份 launcher summary 的 outputDir 记录，完整服务日志保留于该临时目录。提交中的场景摘要只将截图路径改为同目录文件名，业务断言和结果未修改；旧失败证据保持原样。
