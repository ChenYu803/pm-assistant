# 08 — v1.1 综合回放验证

**What to build:** 实现当前尚不存在的 v1.1 综合回放验证脚本，覆盖 01–07 全部验收点。沿用现有 verify 脚本的 Playwright 驱动 UI、直调 API、幂等新用户建号和 check 断言模式。默认使用 `AI_MODE=replay`，覆盖 UI、SSE、marker、确认框、冻结状态、文件写入、数据库和协议行为，不调用真实模型。脚本完成后，既有四环验证入口按风险和发布候选纪律运行，不把日常真实模型回归设为本票门槛。

**Blocked by:** 01–07（全部功能票）

**Status:** done

- [x] 01–07 各验收点均有对应断言且全绿
- [x] 默认 `AI_MODE=replay` 即可运行，不要求 API key，不调用真实模型；重复运行幂等且无需清场
- [x] ticket01 的迁移后回放审计有独立结果，不因审计缺口重新打开 ticket01
- [x] 完整四环真实回归仅在发布候选或确有必要时安排一次；运行前明确验证假设、预计轮数和 token/API 成本并取得用户同意

## Comments

- 2026-08-21：新增 `scripts/verify-v11-ux.mjs` 作为综合 replay 入口，顺序执行票 01 迁移审计、02/04/07 消息交互、03 Agent 自我说明、05 编辑重发、06 上下文预警和跨 Agent 协议安全网。新增内部票 01 审计脚本，覆盖文件更新、命名和空状态引导。入口强制 `AI_MODE=replay`，并统一兼容 `VERIFY_BASE_URL` / `BASE_URL`；调用聊天前通过仅开发环境的 `/api/verify/replay-mode` 确认服务端同为 replay，live 服务会被拒绝。
- 验证：`AI_MODE=replay VERIFY_BASE_URL=http://localhost:3000 node scripts/verify-v11-ux.mjs` 全绿（6 个专项：17 + 24 + 25 + 12 + 6 + 27 条断言）。未调用真实模型；四环真实回归仍仅在发布候选或另行批准后执行。
