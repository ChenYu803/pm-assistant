import fs from "node:fs";
const p = "src/components/prototype/HeroTurntablePrototype.tsx";
let s = fs.readFileSync(p, "utf8");
const a = `  const faceChangeRef = useRef(onFaceChange);
  faceChangeRef.current = onFaceChange;
`;
const b = `  const faceChangeRef = useRef(onFaceChange);

  useEffect(() => {
    faceChangeRef.current = onFaceChange;
  }, [onFaceChange]);
`;
if (!s.includes(a)) { console.log("MISS"); process.exit(1); }
fs.writeFileSync(p, s.replace(a, b));
