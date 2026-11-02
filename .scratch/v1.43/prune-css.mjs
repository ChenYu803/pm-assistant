import fs from "node:fs";
const p = "src/components/LandingPage.module.css";
let lines = fs.readFileSync(p, "utf8").split("\n");
const drop = [/^\.artifactSpace/, /^\.artifactStack/, /^\.heroSheet/, /^\.sheetTitle \{/, /^\.artifactControls/];
const before = lines.length;
lines = lines.filter((line) => !drop.some((re) => re.test(line.trim())));
// 节选在媒体查询里的是缩进过的，上面按 trim 判断已覆盖
// artifactCaption 只拆掉它自己，保留 .deliveryCaption
lines = lines.map((line) => line.includes(".artifactCaption, .deliveryCaption")
  ? line.replace(".artifactCaption, .deliveryCaption", ".deliveryCaption")
  : line);
lines = lines.map((line) => line.replace(/^(\s*)\.artifactCaption \{ font-size: 11px; \}$/, "").trimEnd());
fs.writeFileSync(p, lines.join("\n"));
console.log("removed", before - lines.length, "lines");
