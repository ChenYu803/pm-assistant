import fs from "node:fs";
const p = "src/components/LandingPage.module.css";
let s = fs.readFileSync(p, "utf8");
const before = s;
s = s.replace(".artifactStage { --aim-x: 0; --aim-y: 0; min-width: 0; }", ".artifactStage { min-width: 0; }");
// 清理删除行后可能留下的空行堆
s = s.replace(/\n{3,}/g, "\n\n");
fs.writeFileSync(p, s);
console.log(s.slice(s.indexOf(".artifactStage {"), s.indexOf(".artifactStage {") + 80));
