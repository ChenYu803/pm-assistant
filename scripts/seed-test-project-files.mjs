// 仅为指定测试账号的唯一“测试”项目补充验收样例；重复运行不覆盖用户编辑。
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const samples = [
  ["需求分析.md", `# 项目文件树体验：需求分析样例

## 背景

用户会在同一个项目中持续开展多轮产品迭代，需要集中查看已经确认的成果。

## 用户问题

- 文件散落在不同迭代里时，难以判断哪份是当前版本。
- 打开文件前，用户需要先知道它属于哪个工作阶段。

## 验收观察点

1. 文件树始终展示需求分析、原型、PRD、任务拆分四个分类。
2. 打开文件可阅读完整 Markdown 正文。
3. 下载得到与预览相同的当前正文。
`],
  ["原型.md", `# 项目文件树：原型样例

## 页面结构

项目详情包含两个同级视图：**产品迭代**与**项目文件树**。首次进入默认展示产品迭代。

## 关键交互

1. 点击“项目文件树”查看四个固定分类。
2. 展开分类，点击文件名打开预览。
3. 在预览中下载 Markdown，按 Escape 关闭后焦点回到文件名。

> 这是验收用样例，不代表正式设计决策。
`],
  ["prd.md", `# 项目文件树：PRD 样例

## 目标

让用户在项目级入口集中浏览和下载当前成果。

## 功能范围

| 功能 | 预期结果 |
| --- | --- |
| 切换视图 | 进入项目默认显示产品迭代，可切到项目文件树 |
| 浏览目录 | 四个分类稳定存在，空分类也可见 |
| 文件预览 | Markdown 按正文渲染 |
| 文件下载 | 下载当前纯 Markdown 正文 |

## 边界

没有当前迭代时，文件树仅供浏览、预览和下载。
`],
  ["issues/01-项目视图切换.md", `# 项目视图切换

**What to build:** 在项目详情中提供产品迭代与项目文件树两个同级视图，默认选中产品迭代。

**Blocked by:** 无

**验收标准:** 选择项目后看到产品迭代；切换到文件树后能看到四个分类。
`],
  ["issues/02-文件预览与下载.md", `# 文件预览与下载

**What to build:** 从项目文件树打开 Markdown 预览并下载当前正文。

**Blocked by:** 01-项目视图切换

**验收标准:** 预览和下载内容一致；关闭预览后回到原文件位置。
`],
];

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

try {
  await connection.beginTransaction();
  const [projects] = await connection.query(
    "SELECT p.id, p.next_iteration_number FROM projects p JOIN users u ON u.id = p.user_id WHERE u.email = ? AND p.name = ? FOR UPDATE",
    ["test1@example.com", "测试"],
  );
  if (projects.length !== 1) throw new Error(`目标项目数量应为 1，实际为 ${projects.length}`);
  const projectId = projects[0].id;
  const [iterations] = await connection.query("SELECT iteration_number FROM product_iterations WHERE project_id = ? ORDER BY iteration_number LIMIT 1", [projectId]);
  let iterationNumber = iterations[0]?.iteration_number;
  if (!iterationNumber) {
    iterationNumber = Number(projects[0].next_iteration_number);
    await connection.query(
      "INSERT INTO product_iterations (id, project_id, iteration_number, display_name, goal) VALUES (?, ?, ?, ?, ?)",
      [randomUUID(), projectId, iterationNumber, "样例验收", "查看项目文件树、预览与下载文件，并体验只读演示会话。"],
    );
    await connection.query("UPDATE projects SET next_iteration_number = ? WHERE id = ?", [iterationNumber + 1, projectId]);
  }
  samples.push([`issues/iteration-${iterationNumber}/03-迭代任务样例.md`, `# 迭代任务样例\n\n**What to build:** 在迭代 ${iterationNumber} 中核对项目文件树的共享文件。\n\n**Blocked by:** 无\n\n**验收标准:** 文件出现在“迭代 ${String(iterationNumber).padStart(2, "0")}”文件夹，可以预览和下载。\n`]);
  const [existing] = await connection.query("SELECT filename FROM project_files WHERE project_id = ? FOR UPDATE", [projectId]);
  const existingNames = new Set(existing.map((file) => file.filename));
  let inserted = 0;
  for (const [filename, content] of samples) {
    if (existingNames.has(filename)) continue;
    await connection.query(
      "INSERT INTO project_files (id, project_id, filename, content, version) VALUES (?, ?, ?, ?, 1)",
      [randomUUID(), projectId, filename, content],
    );
    inserted++;
  }
  await connection.commit();
  console.log(`测试项目样例：新增 ${inserted} 个，已有 ${samples.length - inserted} 个；样例迭代 ${iterationNumber}；项目 ${projectId}`);
} catch (error) {
  await connection.rollback();
  console.error(error);
  process.exitCode = 1;
} finally {
  await connection.end();
}
