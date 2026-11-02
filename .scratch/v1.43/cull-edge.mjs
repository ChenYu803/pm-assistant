import fs from "node:fs";
const p = "src/components/HeroTurntable.tsx";
let s = fs.readFileSync(p, "utf8");
const anchor = `        const content = Math.max(0, Math.min(1, (Math.cos(theta) - 0.34) / 0.46));
        faces[i].style.setProperty("--content", content.toFixed(3));
`;
if (!s.includes(anchor)) throw new Error("anchor missing");
s = s.replace(anchor, `${anchor}        /* 面侧对屏幕时（±90°）只剩一条 1px 亮边，会像凭空多出一根杂线；±5° 内渐隐掉。 */
        const edge = Math.max(0, Math.min(1, (Math.abs(Math.cos(theta)) - 0.02) / 0.06));
        faces[i].style.opacity = edge.toFixed(3);
`);
fs.writeFileSync(p, s);
console.log("patched");
