import fs from "node:fs";
const p = "src/components/LandingPage.tsx";
let s = fs.readFileSync(p, "utf8");
s = s.replace("    let frame = 0, lastTime = 0;\n", "    let frame = 0;\n");
s = s.replace(
  `    const draw = (time: number) => {
      frame = 0;
      const dt = Math.min((time - (lastTime || time - 16)) / 1000, .05);
      lastTime = time;
      void dt;
`,
  `    const draw = () => {
      frame = 0;
`,
);
s = s.replace(
  '    const schedule = () => { if (!frame) { lastTime = 0; frame = requestAnimationFrame(draw); } };\n    const reset = () => { schedule(); };\n',
  "    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };\n",
);
s = s.replace('    reduced.addEventListener("change", reset);\n', '    reduced.addEventListener("change", schedule);\n');
s = s.replace('      reduced.removeEventListener("change", reset);\n', '      reduced.removeEventListener("change", schedule);\n');
s = s.replace(
  "/** 使用真实滚动容器；滚动不重复缓动，指针阻尼与帧率无关，静止后停帧。 */",
  "/** 产品实践区的滚动接力：用真实滚动位置算 progress / phase，静止后不再续帧。 */",
);
fs.writeFileSync(p, s);
console.log(s.slice(s.indexOf("function useLandingMotion"), s.indexOf("export default function LandingPage")));
