import fs from "node:fs";
const p = "src/components/HeroTurntable.module.css";
let s = fs.readFileSync(p, "utf8");
const bad = `/* 原型专用：首屏右侧「成果转台」——一份成果的四个面，可以真的转过去看。
   视觉沿用首页令牌，只在 LandingPage.module.css 之上补这一层。 */
`;
if (!s.includes(bad)) { console.log("MISS head"); }
s = s.replace(bad, "");
fs.writeFileSync(p, s);
console.log(s.split("\n").slice(0, 4).join("\n"));
