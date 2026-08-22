# 02 — 项目边界与文件参数隔离

**What to build:** 用户只能在当前项目内加载、读取、修改、下载和润色文件；跨项目访问被拒绝，非法 `fileId` 与合法但不存在的文件返回不同的明确错误。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 项目 A 的 tab 不能加载项目 B 的文件，已有跨项目上下文残留也不能进入 Agent 上下文。
- [x] 通过项目 A 的 URL 读取、修改、下载或润色项目 B 的文件都会被拒绝。
- [x] 同项目的文件加载、读取、修改、下载和润色主路径保持可用。
- [x] 非法 `fileId` 返回参数错误，合法但不存在的 `fileId` 返回资源不存在错误。
- [x] 隔离和参数校验由 API 外部行为可验证，不依赖前端隐藏入口。

## 相关 spec

见 v1.2 spec 的“项目隔离与文件 API”和“项目 ownership”。
