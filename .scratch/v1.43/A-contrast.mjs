const L = (hex) => {
  const m = hex.replace('#','').match(/../g).map(h=>parseInt(h,16)/255);
  const c = m.map(v => v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4));
  return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
};
const blend = (fg, alpha, bg) => {
  const f = fg.replace('#','').match(/../g).map(h=>parseInt(h,16));
  const b = bg.replace('#','').match(/../g).map(h=>parseInt(h,16));
  const o = f.map((v,i)=>Math.round(alpha*v+(1-alpha)*b[i]));
  return '#'+o.map(v=>v.toString(16).padStart(2,'0')).join('');
};
const ratio = (a,b) => { const l1=L(a), l2=L(b); const hi=Math.max(l1,l2), lo=Math.min(l1,l2); return ((hi+0.05)/(lo+0.05)); };
const rows = [
 ['cream type on page',        '#e9dfc8','#171713'],
 ['cream type on surface',     '#e9dfc8','#1e1f19'],
 ['cream type on panel',       '#e9dfc8','#262720'],
 ['muted #b1ab98 on page',     '#b1ab98','#171713'],
 ['muted on surface',          '#b1ab98','#1e1f19'],
 ['muted on panel',            '#b1ab98','#262720'],
 ['work-accent #d76a52 on surface','#d76a52','#1e1f19'],
 ['work-accent on panel',      '#d76a52','#262720'],
 ['coral #ed6f5c on page',     '#ed6f5c','#171713'],
 ['placeholder #8b8574 on #22231d','#8b8574','#22231d'],
 ['#a9a493 on page',           '#a9a493','#171713'],
 ['success #6aa583 on surface','#6aa583','#1e1f19'],
 ['#7fbb8a on surface',        '#7fbb8a','#1e1f19'],
 ['#e08a76 on surface',        '#e08a76','#1e1f19'],
 ['#efa294 on surface',        '#efa294','#1e1f19'],
 ['#7c7768 on #1a1b15',        '#7c7768','#1a1b15'],
 ['c6bda6 on #262720',         '#c6bda6','#262720'],
];
console.log('--- solid token pairs ---');
for (const [n,f,b] of rows) console.log(`${ratio(f,b).toFixed(2).padStart(6)}:1  ${n}`);
console.log('\n--- alpha-applied pairs ---');
const A = [
 ['stage-index rgba(21,20,15,.65) over #1e1f19', blend('#151410',0.65,'#1e1f19'), '#1e1f19'],
 ['iteration-updated rgba(21,20,15,.54) over #171713', blend('#151410',0.54,'#171713'), '#171713'],
 ['iteration-goal.empty rgba(21,20,15,.54) over #171713', blend('#151410',0.54,'#171713'), '#171713'],
 ['iteration-row:hover rgba(247,241,222,.42) over #171713', blend('#f7f1de',0.42,'#171713'), '#171713'],
 ['cream type #e9dfc8 ON that hover', '#e9dfc8', blend('#f7f1de',0.42,'#171713')],
 ['toast text #1e1f19 on #262720', '#1e1f19', '#262720'],
 ['risk item bg rgba(247,241,222,.5) over #1e1f19', blend('#f7f1de',0.5,'#1e1f19'), '#1e1f19'],
 ['muted #b1ab98 ON that risk bg', '#b1ab98', blend('#f7f1de',0.5,'#1e1f19')],
 ['session-row text rgba(247,241,222,.82) on #262720', blend('#f7f1de',0.82,'#262720'), '#262720'],
 ['session small rgba(247,241,222,.68) on #262720', blend('#f7f1de',0.68,'#262720'), '#262720'],
 ['nav border #45463a on page', '#45463a', '#171713'],
 ['--work-line rgba(233,223,200,.16) over #171713', blend('#e9dfc8',0.16,'#171713'), '#171713'],
 ['--work-line over #1e1f19', blend('#e9dfc8',0.16,'#1e1f19'), '#1e1f19'],
];
for (const [n,f,b] of A) console.log(`${ratio(f,b).toFixed(2).padStart(6)}:1  ${n}   [fg ${f}]`);
