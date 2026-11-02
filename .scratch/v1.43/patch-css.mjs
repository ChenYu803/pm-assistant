import fs from "node:fs";
const p = "src/components/prototype/HeroTurntablePrototype.module.css";
let s = fs.readFileSync(p, "utf8");
const before = s;
const rep = (a, b) => { if (!s.includes(a)) { console.log("MISS:", a.slice(0, 60)); return; } s = s.replace(a, b); };

rep(`  perspective: 1700px;\n  perspective-origin: 50% 44%;`, `  perspective: 1150px;\n  perspective-origin: 50% 42%;`);

rep(`.drumWrap {
  grid-area: drum;
  position: relative;
  display: grid;
  place-items: center;
  min-height: clamp(400px, 42vw, 540px);
}

.baseRing {
  position: absolute;
  bottom: 6px;
  width: min(86%, 400px);
  aspect-ratio: 3.6 / 1;
  border: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
  border-radius: 50%;
  box-shadow: 0 26px 60px rgba(0, 0, 0, .5);
  pointer-events: none;
}

.baseShadow {
  position: absolute;
  bottom: 18px;
  width: min(52%, 240px);
  height: 26px;
  background: radial-gradient(50% 50% at 50% 50%, rgba(0, 0, 0, .72), rgba(0, 0, 0, 0) 72%);
  filter: blur(7px);
  pointer-events: none;
}`, `.drumWrap {
  grid-area: drum;
  display: grid;
  place-items: center;
  min-height: clamp(430px, 45vw, 580px);
  padding-bottom: 30px;
}

.drumBox {
  position: relative;
  display: grid;
  place-items: center;
}

/* 台面：一道几乎水平的椭圆，只在边缘留一点反光，托住这个物体。 */
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
}

.baseShadow {
  position: absolute;
  bottom: -42px;
  left: 50%;
  width: 62%;
  height: 22px;
  transform: translateX(-50%);
  background: radial-gradient(50% 50% at 50% 50%, rgba(0, 0, 0, .85), rgba(0, 0, 0, 0) 74%);
  filter: blur(9px);
  pointer-events: none;
}`);

rep(`  width: clamp(268px, 25vw, 372px);`, `  width: clamp(284px, 26vw, 396px);`);

rep(`  background:
    linear-gradient(158deg, rgba(233, 223, 200, .045), rgba(233, 223, 200, 0) 46%),
    linear-gradient(180deg, #262720 0%, #1c1d18 62%, #191a15 100%);
  border: 1px solid var(--line);
  box-shadow:
    inset 0 0 0 1px rgba(233, 223, 200, .025),
    inset 0 -40px 80px rgba(0, 0, 0, .32);`, `  background:
    linear-gradient(158deg, rgba(233, 223, 200, .07), rgba(233, 223, 200, 0) 48%),
    linear-gradient(180deg, #30312a 0%, #23241d 58%, #1e1f19 100%);
  border: 1px solid color-mix(in srgb, var(--line) 86%, #e9dfc8);
  box-shadow:
    inset 0 1px 0 rgba(233, 223, 200, .18),
    inset 1px 0 0 rgba(233, 223, 200, .07),
    inset -1px 0 0 rgba(0, 0, 0, .5),
    inset 0 -1px 0 rgba(0, 0, 0, .55),
    inset 22px 0 34px -26px rgba(0, 0, 0, .75),
    inset -22px 0 34px -26px rgba(0, 0, 0, .75),
    inset 0 -60px 90px rgba(0, 0, 0, .26);`);

rep(`  right: 14px;\n  bottom: -34px;`, `  right: -8px;\n  bottom: -56px;`);
rep(`  font: 400 132px/1 var(--serif);`, `  font: 400 196px/1 var(--serif);`);
rep(`  font: 400 clamp(24px, 2vw, 31px)/1.34 var(--serif);`, `  font: 400 clamp(25px, 2.1vw, 33px)/1.32 var(--serif);`);
rep(`  font: 12.5px/1.4 var(--sans);`, `  font: 13px/1.4 var(--sans);`);

fs.writeFileSync(p, s);
console.log("changed:", before !== s);
