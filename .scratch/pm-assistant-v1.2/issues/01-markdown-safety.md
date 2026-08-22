# 01 — Markdown 安全渲染

**What to build:** 用户可以正常阅读 Agent 输出的 Markdown；安全链接保持可用，危险协议、属性注入和不安全的代码围栏语言名被降级为安全文本，不执行脚本也不破坏聊天布局。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `http`、`https`、`mailto` 链接按预期渲染并可访问。
- [x] `javascript:` 等危险协议不会生成可执行链接。
- [x] 引号、属性片段、HTML 注入和恶意代码围栏语言名不会改变页面结构或执行脚本。
- [x] 普通标题、列表、代码块和协议 marker 的现有展示行为不回归。

## 相关 spec

见 v1.2 spec 的“安全输入与 Markdown 展示”和“Markdown 安全边界”。
