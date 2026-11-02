import fs from "node:fs";
const p = "src/components/prototype/HeroTurntablePrototype.tsx";
let s = fs.readFileSync(p, "utf8");
s = s.replace(`                <div
                ref={drumRef}
                className={styles.drum}
                role="group"
                aria-label="成果转台：一份成果的四个面，可拖动或按左右方向键换面"
                tabIndex={0}
                onKeyDown={onKeyDown}
              >`, `                <div
                  ref={drumRef}
                  className={styles.drum}
                  role="group"
                  aria-label="成果转台：一份成果的四个面，可拖动或按左右方向键换面"
                  tabIndex={0}
                  onKeyDown={onKeyDown}
                >`);
fs.writeFileSync(p, s);
