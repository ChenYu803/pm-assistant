import fs from "node:fs";
const p = "src/components/LandingPage.tsx";
let s = fs.readFileSync(p, "utf8");

s = s.replace('import LandingInteractionPrototype, { PrototypeSwitcher, type LandingVariant } from "./LandingInteractionPrototype";\n', "");
s = s.replace("function useLandingMotion(rootRef: RefObject<HTMLDivElement | null>, prototypeVariant: LandingVariant | null) {", "function useLandingMotion(rootRef: RefObject<HTMLDivElement | null>) {");
s = s.replace("  }, [rootRef, prototypeVariant]);\n", "  }, [rootRef]);\n");
s = s.replace("  const [prototypeVariant, setPrototypeVariant] = useState<LandingVariant | null>(null);\n  useLandingMotion(rootRef, prototypeVariant);\n", "  useLandingMotion(rootRef);\n");

// 删掉整个 dev 变体切换 effect 与选择函数
const effStart = s.indexOf("  useEffect(() => {\n    if (process.env.NODE_ENV !== \"development\") return;");
const effEnd = s.indexOf("  return (\n    <div className={styles.shell} ref={rootRef}>");
if (effStart < 0 || effEnd < 0) throw new Error("effect markers missing");
s = s.slice(0, effStart) + s.slice(effEnd);

s = s.replace("        {process.env.NODE_ENV === \"development\" && prototypeVariant ? <LandingInteractionPrototype variant={prototypeVariant} /> : <section className={styles.hero} data-landing-id=\"hero-section\">", "        <section className={styles.hero} data-landing-id=\"hero-section\">");
s = s.replace("      {process.env.NODE_ENV === \"development\" && prototypeVariant && <PrototypeSwitcher variant={prototypeVariant} onChange={selectPrototypeVariant} />}\n", "");
// 原来的三元条件在 section 结束后还有个 `}`，去掉
s = s.replace("        </section>}\n", "        </section>\n");
fs.writeFileSync(p, s);
console.log("done");
