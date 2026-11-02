import fs from "node:fs";
const p = "src/components/LandingPage.tsx";
let s = fs.readFileSync(p, "utf8");
const before = s;

// 1) import 正式组件与共享数据
s = s.replace(
  'import styles from "./LandingPage.module.css";\n',
  'import styles from "./LandingPage.module.css";\nimport HeroTurntable from "./HeroTurntable";\nimport { deliverables } from "./landingDeliverables";\n',
);

// 2) 删掉本地 deliverables 常量
s = s.replace(/const deliverables = \[[\s\S]*?\] as const;\n\n/, "");

// 3) useLandingMotion 去掉转台指针逻辑
s = s.replace(
  '    const hero = root.querySelector<HTMLElement>("[data-artifact-stage]")!;\n',
  "",
);
s = s.replace("    let x = 0, y = 0, targetX = 0, targetY = 0;\n", "");
s = s.replace(
  `      const gain = 1 - Math.exp(-18 * dt);
      x += (targetX - x) * gain;
      y += (targetY - y) * gain;
      if (Math.abs(x - targetX) < .001) x = targetX;
      if (Math.abs(y - targetY) < .001) y = targetY;
      hero.style.setProperty("--aim-x", x.toFixed(4));
      hero.style.setProperty("--aim-y", y.toFixed(4));
`,
  "",
);
s = s.replace("      if (x !== targetX || y !== targetY) frame = requestAnimationFrame(draw);\n", "");
s = s.replace(
  `    const reset = () => { targetX = targetY = 0; schedule(); };
    const move = (event: PointerEvent) => {
      if (reduced.matches || !finePointer.matches) return;
      const box = hero.getBoundingClientRect();
      targetX = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1));
      targetY = Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1));
      schedule();
    };
`,
  "    const reset = () => { schedule(); };\n",
);
s = s.replace('    hero.addEventListener("pointermove", move);\n    hero.addEventListener("pointerleave", reset);\n', "");
s = s.replace('      hero.removeEventListener("pointermove", move);\n      hero.removeEventListener("pointerleave", reset);\n', "");
s = s.replace(
  "    const finePointer = matchMedia(\"(hover: hover) and (pointer: fine)\");\n",
  "",
);
s = s.replace('    finePointer.addEventListener("change", reset);\n', "");
s = s.replace('      finePointer.removeEventListener("change", reset);\n', "");

// draw 里每帧无变化时不再重排（原本靠 x/y 变化判断，现在只有一个 scroll/resize 需求，直接不续帧）
s = s.replace(
  `      const dt = Math.min((time - (lastTime || time - 16)) / 1000, .05);
      lastTime = time;
`,
  `      const dt = Math.min((time - (lastTime || time - 16)) / 1000, .05);
      lastTime = time;
      void dt;
`,
);

// 4) 删掉 artifact state
s = s.replace("  const [artifact, setArtifact] = useState(0);\n", "");

// 5) hero 里整块换成一个组件
const stageStart = s.indexOf('            <div className={styles.artifactStage} data-artifact-stage>');
const stageEnd = s.indexOf('            </div>\n          </div>\n          <div className={styles.container + " " + styles.heroBottom}>');
if (stageStart < 0 || stageEnd < 0) throw new Error("hero stage markers missing");
s = s.slice(0, stageStart) + '            <div className={styles.artifactStage}><HeroTurntable /></div>\n' + s.slice(stageEnd + '            </div>\n'.length);

fs.writeFileSync(p, s);
console.log("changed:", s !== before, "lines:", s.split("\n").length);
