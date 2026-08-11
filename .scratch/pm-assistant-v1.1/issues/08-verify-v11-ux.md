# 08 — verify-v11-ux.mjs 综合验证

**What to build:** 新增综合验证脚本 `scripts/verify-v11-ux.mjs`，覆盖 01–07 全部验收点。沿用现有 verify-*.mjs 模式（Playwright 驱动 UI + 直调 API + 幂等新用户建号 + check 断言）。多数断言纯 UI/API 驱动（分钟级）；需真实 LLM 对话的仅「文件更新修复」（写入 → 修改 → 再确认更新）与「替换式重新输出」（一轮对话），用最少轮数；脚本整体目标 <10 分钟。跑通后另跑 verify-v1-flow.mjs 回归，确认四环写入协议不受 01 修复影响（01 属 L2 级改动，回归是必选项）。

**Blocked by:** 01–07（全部功能票）

**Status:** ready-for-agent

- [ ] 01–07 各验收点均有对应断言且全绿
- [ ] 脚本整体 <10 分钟；幂等（重复运行无需清场，新用户建号）
- [ ] verify-v1-flow.mjs 回归全绿（82 断言，确认四环不受影响）
