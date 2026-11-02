import fs from "node:fs";
const cp = "src/components/prototype/HeroTurntablePrototype.module.css";
let c = fs.readFileSync(cp, "utf8");
const rc = (a, b) => { if (!c.includes(a)) { console.log("CSS MISS:", a.slice(0, 50)); return; } c = c.replace(a, b); };

rc(`.drumBox {
  position: relative;
  display: grid;
  place-items: center;
}`, `.drumBox {
  position: relative;
  display: grid;
  place-items: center;
}`);

rc(`/* 台面：一道几乎水平的椭圆，只在边缘留一点反光，托住这个物体。 */
.baseRing {
  position: absolute;
  bottom: -24px;
  left: 50%;
  width: 118%;
  height: 48px;
  transform: translateX(-50%);
  border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
  border-radius: 50%;
  background: radial-gradient(58% 100% at 50% 0%, rgba(0, 0, 0, .5), rgba(0, 0, 0, 0) 70%);
  pointer-events: none;
}`, `/* 台面：一圈刻度盘 + 一枚跟着转的珊瑚色指示点，让「转了多少」有读数。 */
.platter {
  position: absolute;
  bottom: -18px;
  left: 50%;
  width: 108%;
  height: 46px;
  transform: translateX(-50%);
  border: 1px solid color-mix(in srgb, var(--line) 88%, transparent);
  border-radius: 50%;
  background: radial-gradient(56% 108% at 50% 0%, rgba(0, 0, 0, .55), rgba(0, 0, 0, 0) 72%);
  pointer-events: none;
}

.platter::before {
  content: "";
  position: absolute;
  inset: 5px 11px;
  border: 1px solid rgba(233, 223, 200, .07);
  border-radius: 50%;
}

.tick {
  position: absolute;
  background: color-mix(in srgb, var(--line) 75%, transparent);
}

.tick[data-t="0"] { left: 50%; top: -4px; width: 1px; height: 7px; }
.tick[data-t="1"] { right: -3px; top: 50%; width: 7px; height: 1px; }
.tick[data-t="2"] { left: 50%; bottom: -4px; width: 1px; height: 7px; }
.tick[data-t="3"] { left: -3px; top: 50%; width: 7px; height: 1px; }

.orbitDot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 5px;
  height: 5px;
  margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 12px rgba(237, 111, 92, .85);
  will-change: transform;
}`);

rc(`.drum {
  position: relative;
  width: clamp(284px, 26vw, 396px);`, `.drum {
  position: relative;
  width: clamp(300px, 27vw, 404px);`);

rc(`.face > * {
  position: relative;
  z-index: 1;
}`, `.face > * {
  position: relative;
  z-index: 1;
  /* 侧到看不见正面的面只剩纸边，不让文字侧着露出来。 */
  opacity: var(--content, 1);
}`);

fs.writeFileSync(cp, c);

const tp = "src/components/prototype/HeroTurntablePrototype.tsx";
let s = fs.readFileSync(tp, "utf8");
const rt = (a, b) => { if (!s.includes(a)) { console.log("TSX MISS:", a.slice(0, 50)); return; } s = s.replace(a, b); };

rt(`    const faces = Array.from(drum.querySelectorAll<HTMLElement>("[data-face]"));`,
   `    const faces = Array.from(drum.querySelectorAll<HTMLElement>("[data-face]"));
    const platter = drum.parentElement?.querySelector<HTMLElement>("[data-platter]");
    const dot = drum.parentElement?.querySelector<HTMLElement>("[data-orbit]");`);

rt(`    const render = () => {
      drum.style.transform = \`translateZ(calc(var(--r) * -1)) rotateY(\${angle}deg)\`;`,
   `    const render = () => {
      /* 先俯一点（-7°），静帧才有「从略高处看一个物体」的透视，而不是一张贴纸。 */
      drum.style.transform = \`translateZ(calc(var(--r) * -1)) rotateX(-7deg) rotateY(\${angle}deg)\`;`);

rt(`        const lit = Math.cos(theta + 0.38);
        const dim = Math.min(0.88, 0.58 * (1 - Math.max(0, lit)) + (lit < 0 ? 0.1 : 0));
        faces[i].style.setProperty("--dim", dim.toFixed(3));
      }`,
   `        const lit = Math.cos(theta + 0.38);
        const dim = Math.min(0.88, 0.58 * (1 - Math.max(0, lit)) + (lit < 0 ? 0.1 : 0));
        faces[i].style.setProperty("--dim", dim.toFixed(3));
        const content = Math.max(0, Math.min(1, (Math.cos(theta) - 0.34) / 0.46));
        faces[i].style.setProperty("--content", content.toFixed(3));
      }
      if (dot && platter) {
        const w = platter.clientWidth / 2;
        const h = platter.clientHeight / 2;
        const rad = (angle * Math.PI) / 180;
        dot.style.transform = \`translate(\${(Math.sin(rad) * w).toFixed(1)}px, \${(Math.cos(rad) * h).toFixed(1)}px)\`;
      }`);

rt(`              <span className={styles.baseRing} aria-hidden="true" />
                <span className={styles.baseShadow} aria-hidden="true" />`,
   `              <span className={styles.baseShadow} aria-hidden="true" />
                <span className={styles.platter} data-platter aria-hidden="true">
                  <i className={styles.tick} data-t="0" />
                  <i className={styles.tick} data-t="1" />
                  <i className={styles.tick} data-t="2" />
                  <i className={styles.tick} data-t="3" />
                  <span className={styles.orbitDot} data-orbit />
                </span>`);

fs.writeFileSync(tp, s);
