import fs from "node:fs";
const src = fs.readFileSync("src/components/prototype/HeroTurntablePrototype.tsx", "utf8");

const cut = src.indexOf("export default function HeroTurntablePrototype()");
let head = src.slice(0, cut).trimEnd();

const startMark = '          <div className={styles.stage} data-turntable>';
const endMark = '        <div className={landing.container + " " + landing.heroBottom}>';
const sIdx = src.indexOf(startMark);
const eIdx = src.indexOf(endMark);
if (sIdx < 0 || eIdx < 0) throw new Error("marker not found " + sIdx + " " + eIdx);
let stage = src.slice(sIdx, eIdx).trimEnd();
// 这一段尾巴是 heroLayout 的收尾 </div>，不属于舞台
const tailIdx = stage.lastIndexOf("</div>");
stage = stage.slice(0, tailIdx).trimEnd();

head = head
  .replace('import Link from "next/link";\n', "")
  .replace('import landing from "@/components/LandingPage.module.css";\n', "")
  .replace(
    'import styles from "./HeroTurntablePrototype.module.css";',
    'import styles from "./HeroTurntable.module.css";\nimport { deliverables } from "./landingDeliverables";',
  );

head = head.replace(
  /\/\*\*[\s\S]*?\*\/\n(?=const deliverables)/,
  `/**
 * 首屏右侧的「成果转台」：同一份成果的四个面（需求分析 / 原型 / PRD / 任务拆分）。
 *
 * 指针横向拖动让整台带惯性转过去，松手吸附到 90° 档位；无人操作时自己缓慢转，
 * 用来引起第一次接触。每一面按面法线与光向的夹角压暗，而不是按「正对屏幕的
 * 程度」对称压暗——有方向的受光才读得出这是个物体，不是两块并排的面板。
 * 用 CSS 3D 组合而非逐帧物理积分：静止时零开销，静帧就是设计终态。
 */
`,
);
head = head.replace(/const deliverables = \[[\s\S]*?\] as const;\n\n/, "");
head = head.replace(/function Arrow\([\s\S]*?\n\}\n\n/, "");

stage = stage
  .replace(
    '<span><b>同一份成果，四个面。</b> 转过去看，它怎么长出来。</span>',
    "<span><b>AI开发工作流</b></span>",
  )
  .replace(
    `            <div className={styles.hint}>
              <i aria-hidden="true" />
              <span>它会慢慢转 —— 按住就能拨到任意一面</span>
            </div>`,
    `            <div className={styles.hint}>
              <span>可拖拽旋转</span>
            </div>`,
  );

// 舞台整体从 10 空格缩进移到 6（组件 return 内），所有行统一去掉 4 个空格
stage = stage
  .split("\n")
  .map((line) => (line.startsWith("    ") ? line.slice(4) : line.trimStart()))
  .join("\n");

const out = `${head}

export default function HeroTurntable() {
  const drumRef = useRef<HTMLDivElement>(null);
  const [face, setFace] = useState(0);
  const onFaceChange = useCallback((next: number) => setFace(next), []);
  const goTo = useTurntable(drumRef, onFaceChange);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    goTo.current(wrapFace(face + step));
  };

  return (
${stage}
  );
}
`;

fs.writeFileSync("src/components/HeroTurntable.tsx", out);
console.log("wrote", out.split("\n").length, "lines");
