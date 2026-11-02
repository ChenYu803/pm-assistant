import fs from "node:fs";
const path = "src/components/prototype/HeroTurntablePrototype.module.css";
const lines = fs.readFileSync(path, "utf8").split("\n");
const L = (a, b) => lines.slice(a - 1, b).join("\n"); // 1-based inclusive

const stageCss = [
  "/* 首屏右侧「成果转台」：四个面 = 四份交付物，拖动/自转/键盘都能转。 */",
  L(1, 318).trimStart(),
  "",
  L(374, 428).trim(),
  "",
].join("\n");

const chromeCss = [
  "/* 原型页外壳：惰性的假导航与底部说明条，只服务 /prototype/hero，不进正式页。 */",
  L(319, 373).trim(),
  "",
  L(429, lines.length).trim(),
  "",
].join("\n");

fs.writeFileSync("src/components/HeroTurntable.module.css", stageCss);
fs.writeFileSync(path, chromeCss);
console.log("stage lines", stageCss.split("\n").length, "chrome lines", chromeCss.split("\n").length);
