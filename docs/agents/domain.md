# Domain Docs

工程 skills 探索代码前，按任务相关性读取：

- 根目录 `GLOSSARY.md`；若存在 `GLOSSARY-MAP.md`，按 map 读取相关上下文的 glossary。
- `docs/adr/` 中与当前任务相关的 ADR；多上下文仓库还应检查 `src/<context>/docs/adr/`。

文件不存在时继续，不必额外提示。领域术语或决策确定后，再通过 domain-modeling 补充相应文档。

## 目录结构

本仓库采用单一上下文：

```text
/
├── GLOSSARY.md
├── docs/adr/
└── src/
```

输出领域概念时沿用 glossary 中的词汇；若缺少必要术语，记录为待补充项。若方案与现存 ADR 冲突，明确指出冲突。
