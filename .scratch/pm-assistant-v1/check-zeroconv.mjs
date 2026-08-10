// 离线复检：与 scripts/verify-v1-flow.mjs 的 splitProtoBlocks（含 normTitle 修复）逐字一致
// 用法: node check-zeroconv.mjs <dir1> [dir2 ...]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (dir, n) => fs.readFileSync(path.join(__dirname, dir, n), "utf8");

const normTitle = (t) => t.replace(/^(##\s*)[一二三四五六七八九十]+[、.．]?\s*/, "$1");

function splitProtoBlocks(body) {
  const top = [];
  let cur = null, sub = null;
  const closeSub = () => { if (sub) { cur.subs.push(sub); sub = null; } };
  const closeTop = () => { if (cur) { closeSub(); top.push(cur); cur = null; } };
  for (const line of body.split("\n")) {
    if (/^---\s*$/.test(line)) continue;
    if (/^# /.test(line)) { closeTop(); continue; }
    if (/^## /.test(line)) { closeTop(); cur = { title: line, text: line, subs: [] }; }
    else if (/^### /.test(line)) { if (cur) { closeSub(); cur.text += "\n" + line; sub = { title: line, text: line }; } }
    else if (cur) { cur.text += "\n" + line; if (sub) sub.text += "\n" + line; }
  }
  closeTop();
  return top;
}

let allOk = true;
for (const dir of process.argv.slice(2)) {
  const protoBody = read(dir, "原型.md");
  const prdBody = read(dir, "prd.md");
  const ch3 = prdBody.match(/##\s*3[.、]\s*页面清单[\s\S]*?(?=##\s*4[.、])/)?.[0] ?? "";
  const ch5 = prdBody.match(/##\s*5[.、]\s*用户流程[\s\S]*?(?=##\s*6[.、])/)?.[0] ?? "";
  let pageMismatch = 0, flowMismatch = 0, pageCount = 0, flowCount = 0;
  for (const top of splitProtoBlocks(protoBody)) {
    if (top.subs.length === 0) {
      const nt = normTitle(top.title);
      if (nt === "## 页面清单" || nt === "## 用户流程" || /^## .*排除/.test(nt)) continue;
      const text = top.text.trim();
      const isFlow = nt.startsWith("## 用户流程");
      if (isFlow) { flowCount++; if (!ch5.includes(text)) flowMismatch++; }
      else { pageCount++; if (!ch3.includes(text)) pageMismatch++; }
    } else {
      for (const b of top.subs) {
        const text = b.text.trim();
        const isFlow = normTitle(b.title).startsWith("## 用户流程") || normTitle(top.title).startsWith("## 用户流程");
        if (isFlow) { flowCount++; if (!ch5.includes(text)) flowMismatch++; }
        else { pageCount++; if (!ch3.includes(text)) pageMismatch++; }
      }
    }
  }
  const ok = flowMismatch === 0 && flowCount > 0 && pageMismatch === 0 && pageCount > 0;
  if (!ok) allOk = false;
  console.log(`${dir}: 页面块=${pageCount} 不一致=${pageMismatch}; 流程块=${flowCount} 不一致=${flowMismatch} → ${ok ? "✅ 零转换通过" : "❌ 失败"}`);
}
process.exit(allOk ? 0 : 1);
