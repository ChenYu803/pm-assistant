import fs from "node:fs";
const p = "src/components/prototype/HeroTurntablePrototype.tsx";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b) => { if (!s.includes(a)) { console.log("MISS:", a.slice(0, 60)); return; } s = s.replace(a, b); };

rep(`      for (let i = 0; i < faces.length; i += 1) {
        /* 面法线相对屏幕的角度：1 = 正对，0 = 侧对，-1 = 背对。 */
        const frontness = Math.cos(((angle + i * STEP) * Math.PI) / 180);
        const dim = Math.max(0, 0.52 * (1 - Math.max(0, frontness)));
        faces[i].style.setProperty("--dim", dim.toFixed(3));
      }`,
`      for (let i = 0; i < faces.length; i += 1) {
        /* 光源在左前方：按面法线跟光的夹角压暗，而不是按「正对屏幕」对称压暗。
           对称压暗会让 45° 时两面一样亮，读起来只是两块并排的面板；有方向才像物体。 */
        const theta = ((angle + i * STEP) * Math.PI) / 180;
        const lit = Math.cos(theta + 0.38);
        const dim = Math.min(0.88, 0.58 * (1 - Math.max(0, lit)) + (lit < 0 ? 0.1 : 0));
        faces[i].style.setProperty("--dim", dim.toFixed(3));
      }`);

rep(`            <div className={styles.drumWrap}>
              <span className={styles.baseRing} aria-hidden="true" />
              <span className={styles.baseShadow} aria-hidden="true" />
              <div`, `            <div className={styles.drumWrap}>
              <div className={styles.drumBox}>
                <span className={styles.baseRing} aria-hidden="true" />
                <span className={styles.baseShadow} aria-hidden="true" />
                <div`);

rep(`                <div className={styles.sway}>
                  {deliverables.map((item, index) => (
                    <article
                      key={item.file}
                      data-face={index}
                      className={styles.face}
                      style={{ transform: \`rotateY(\${index * STEP}deg) translateZ(var(--r))\` } as CSSProperties}
                    >
                      <header className={styles.faceHead}>
                        <span className={styles.file}>{item.file}</span>
                        <span>0{index + 1} / 04</span>
                      </header>
                      <strong className={styles.verb}>{item.verb}</strong>
                      <ul className={styles.lines}>
                        {item.lines.map((line, i) => (
                          <li key={line}><small>0{i + 1}</small>{line}</li>
                        ))}
                      </ul>
                      <footer className={styles.faceFoot}>
                        <span>AI 产品现场</span>
                        <span>交付结构示意</span>
                      </footer>
                      <span className={styles.ghost} aria-hidden="true">0{index + 1}</span>
                    </article>
                  ))}
                </div>
              </div>
            </div>`,
`                  <div className={styles.sway}>
                    {deliverables.map((item, index) => (
                      <article
                        key={item.file}
                        data-face={index}
                        className={styles.face}
                        style={{ transform: \`rotateY(\${index * STEP}deg) translateZ(var(--r))\` } as CSSProperties}
                      >
                        <header className={styles.faceHead}>
                          <span className={styles.file}>{item.file}</span>
                          <span>0{index + 1} / 04</span>
                        </header>
                        <strong className={styles.verb}>{item.verb}</strong>
                        <ul className={styles.lines}>
                          {item.lines.map((line, i) => (
                            <li key={line}><small>0{i + 1}</small>{line}</li>
                          ))}
                        </ul>
                        <footer className={styles.faceFoot}>
                          <span>AI 产品现场</span>
                          <span>交付结构示意</span>
                        </footer>
                        <span className={styles.ghost} aria-hidden="true">0{index + 1}</span>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </div>`);

fs.writeFileSync(p, s);
