import fs from "node:fs";
const p = "src/components/prototype/HeroTurntablePrototype.module.css";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b) => { if (!s.includes(a)) { console.log("MISS:", a.slice(0, 50)); return; } s = s.replace(a, b); };

// 转台窄一点、整体左移一点：给右侧 01–04 索引留出转动半径，拖到 45° 也不会压住数字
rep(`.drum {
  position: relative;
  width: clamp(300px, 27vw, 404px);`, `.drum {
  position: relative;
  width: clamp(300px, 24vw, 356px);`);

rep(`.drumWrap {
  grid-area: drum;
  display: grid;
  place-items: center;
  min-height: clamp(430px, 45vw, 580px);
  padding-bottom: 30px;
}`, `.drumWrap {
  grid-area: drum;
  display: grid;
  place-items: center;
  min-height: clamp(430px, 45vw, 580px);
  /* 右侧留出让纸角转出去的空间：索引数字不能被纸压住 */
  padding: 0 22px 54px 0;
}`);

rep(`.index {
  grid-area: index;
  display: grid;
  align-content: center;
  gap: 1px;
  min-width: 118px;`, `.index {
  grid-area: index;
  display: grid;
  align-content: center;
  gap: 1px;
  min-width: 110px;`);

// 刻度盘压在纸底只露出一条缝，等于没有；整体下移，让它成为托着纸的台面
rep(`.platter {
  position: absolute;
  bottom: -18px;
  left: 50%;
  width: 108%;
  height: 46px;
  transform: translateX(-50%);
  border: 1px solid color-mix(in srgb, var(--line) 88%, transparent);
  border-radius: 50%;`, `.platter {
  position: absolute;
  bottom: -46px;
  left: 50%;
  width: 104%;
  height: 44px;
  transform: translateX(-50%);
  border: 1px solid rgba(233, 223, 200, .16);
  border-radius: 50%;`);

rep(`.tick[data-t="0"] { left: 50%; top: -4px; width: 1px; height: 7px; }
.tick[data-t="1"] { right: -3px; top: 50%; width: 7px; height: 1px; }
.tick[data-t="2"] { left: 50%; bottom: -4px; width: 1px; height: 7px; }
.tick[data-t="3"] { left: -3px; top: 50%; width: 7px; height: 1px; }`, `.tick[data-t="0"] { left: 50%; bottom: -5px; width: 1px; height: 9px; }
.tick[data-t="1"] { right: -4px; top: 50%; width: 9px; height: 1px; }
.tick[data-t="2"] { left: 50%; top: -5px; width: 1px; height: 9px; }
.tick[data-t="3"] { left: -4px; top: 50%; width: 9px; height: 1px; }`);

rep(`  width: 5px;
  height: 5px;
  margin: -2.5px 0 0 -2.5px;`, `  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;`);

fs.writeFileSync(p, s);
