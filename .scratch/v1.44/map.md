# v1.44 实施地图

## Notes

规格见 [spec.md](spec.md)，票状态见各自 `issues/` 文件。

## Decisions-so-far

- 2026-11-02，#01：默认会话名称在首条消息事务中按原文前 10 个字素簇生成；人工名称用独立字段保护，回复终态不再写名称。旧模型命名入口和触发已撤除。验收与范围见 [01 号票](issues/01-local-session-naming.md) 和 [验证记录](../../docs/verification/v144-local-session-naming.md)。

## Fog

- 后续邮箱、积分与后台按票据依赖推进；本票不配置这些外部输入，不代表生产发布。
