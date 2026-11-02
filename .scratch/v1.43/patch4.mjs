import fs from "node:fs";
const p = "src/components/prototype/HeroTurntablePrototype.tsx";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b) => { if (!s.includes(a)) { console.log("MISS:", a.slice(0, 50)); return; } s = s.replace(a, b); };

// 首屏进场就开始转：用户不需要先等 4 秒才知道这东西会动
rep(`    reduced.addEventListener("change", reset);
    if (!reduced.matches) scheduleResume();`, `    reduced.addEventListener("change", reset);
    /* 一进页面就转起来——等用户先摸一下才动，等于不会有第一次接触。 */
    if (!reduced.matches) {
      mode = "auto";
      kick();
    }`);

fs.writeFileSync(p, s);
