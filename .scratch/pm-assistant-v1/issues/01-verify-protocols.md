# 01 — 协议一致性安全网

**What to build:** 一个静态检查脚本（verify-protocols.mjs，与现有 verify 脚本同目录同风格），断言三个协议标记在「prompt 定义处 / 对话运行时冻结执法处 / 前端 marker 解析处」三处保持一致：`%%%FILE_BEGIN%%%`、`%%%FILE_END%%%`、`%%%SCOPE_FROZEN%%%`、肯定词清单。任何一处被改、其余未同步时脚本红灯，输出清晰的不一致报告（哪个标记、哪两处冲突）。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 脚本能从三处读取协议定义并两两比对一致
- [ ] 人为改坏其中一处时脚本红灯并指出冲突位置（自证有效）
- [ ] 当前代码库未改协议时绿灯（现状即基线）
- [ ] 输出格式：标记名 + 冲突文件/行 + 期望值 vs 实际值
- [ ] 可在 dev server 关闭时运行（纯静态读文件，无网络/DB 依赖）

**备注：** 纯技术 ticket，无产品决策，无需用户参与。设计意图：先于 03/05 的 prompt 重构就位，守护三处耦合点。
