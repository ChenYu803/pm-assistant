# Issue tracker：Local Markdown

本仓库当前版本的 spec 与 issue 以 Markdown 文件保存在 `.scratch/<版本号>/`。

## 目录约定

- 每个产品版本使用一个目录，例如 `.scratch/v1.0/`。
- 版本 spec 位于 `.scratch/<版本号>/spec.md`。
- 实现票据各自独立，位于 `.scratch/<版本号>/issues/<NN>-<slug>.md`，从 `01` 编号。
- 票号只在所属版本内唯一；只有票号时，按 `PROGRESS.md` 的当前版本定位。版本不明确或有歧义时，先确认版本。
- 票据状态写在顶部的 `Status:` 行；triage 状态词汇见 `triage-labels.md`。`claimed` / `resolved` 是执行状态，不属于 triage 标签。
- 评论和会话记录追加在 `## Comments` 下方。

## 发布与读取

- 发布当前版本的 spec 或 issue 时，写入对应版本目录。
- 读取票据时优先使用用户提供的完整路径；只给票号时按上述版本规则定位。

## Wayfinding

- Map：`.scratch/<版本号>/map.md`，记录 Notes / Decisions-so-far / Fog。
- Child ticket：`.scratch/<版本号>/issues/<NN>-<slug>.md`，`Type:` 记录类型（`research` / `prototype` / `grilling` / `task`），`Status:` 记录 `claimed` / `resolved`。
- 阻塞关系写在 `Blocked by:` 行；所有阻塞票据均为 `resolved` 后才可开始。
- Frontier：按编号选择首个未完成、未认领且未阻塞的票据。
- Claim 时先将 `Status:` 设为 `claimed` 并保存，再开始工作。
- Resolve 时在 `## Answer` 记录答案，将状态设为 `resolved`，并将上下文摘要和链接追加到 map 的 Decisions-so-far。
