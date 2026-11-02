// WCAG 2.x contrast ratio calculator for the measured palette
const hex = (h) => {
  const s = h.replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
};
const lin = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const L = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => {
  const la = L(hex(a)), lb = L(hex(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

const pairs = [
  ['#b1ab98', '#171713', 'muted text on paper (page bg)'],
  ['#b1ab98', '#1e1f19', 'muted text on surface (conversation)'],
  ['#b1ab98', '#262720', 'muted text on panel (side rails)'],
  ['#c6bda6', '#171713', 'c6bda6 on paper (requested; no such token in src)'],
  ['#d76a52', '#171713', 'hardcoded coral #d76a52 on paper'],
  ['#d76a52', '#1e1f19', 'hardcoded coral #d76a52 on surface'],
  ['#7fbb8a', '#1e1f19', 'stage-status completed green on surface'],
  ['#efa294', '#1e1f19', 'danger text #efa294 on surface'],
  ['#ed6f5c', '#171713', 'actual --work-accent #ed6f5c on paper'],
  ['#ed6f5c', '#1e1f19', 'actual --work-accent #ed6f5c on surface'],
  ['#ed6f5c', '#262720', 'actual --work-accent #ed6f5c on panel'],
  ['#e9dfc8', '#171713', 'ink #e9dfc8 on paper'],
  ['#e9dfc8', '#1e1f19', 'ink #e9dfc8 on surface'],
  ['#e9dfc8', '#262720', 'ink #e9dfc8 on panel'],
  ['#8b8574', '#1e1f19', 'measured textarea ::placeholder on surface'],
  ['#84806f', '#1e1f19', 'disabled btn composite text rgb(132,127,113) on surface'],
  ['#e9dfc8', '#262720', 'disabled btn raw ink on its own panel bg'],
];

const fmt = (n) => n.toFixed(2);
console.log('fg        bg        ratio   AA-normal(4.5) AA-large(3.0) AAA(7)  note');
for (const [fg, bg, note] of pairs) {
  const r = ratio(fg, bg);
  console.log(
    `${fg}  ${bg}  ${fmt(r).padStart(6)}  ${(r >= 4.5 ? 'PASS' : 'FAIL').padEnd(14)} ${(r >= 3 ? 'PASS' : 'FAIL').padEnd(14)} ${(r >= 7 ? 'PASS' : 'FAIL').padEnd(6)}  ${note}`,
  );
}
