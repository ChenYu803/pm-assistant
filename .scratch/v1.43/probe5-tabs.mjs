import fs from 'node:fs';
import { chromium } from 'playwright-core';
const OUT='.scratch/v1.43';
const WB='http://localhost:3000/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b/iterations/019a722c-b732-4281-b785-2df18008f54e';
const EXE='D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const b=await chromium.launch({executablePath:EXE,headless:false,args:['--window-size=1460,1060']});
const c=await b.newContext({storageState:`${OUT}/auth-state.json`,viewport:{width:1440,height:1000}});
const p=await c.newPage();
await p.goto(WB,{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(3000);
const tabs=await p.evaluate(()=>[...document.querySelectorAll('.workbench-stage')].map(t=>{
  const s=getComputedStyle(t), idx=t.querySelector('.stage-index'), st=t.querySelector('.stage-status');
  const r=t.getBoundingClientRect();
  return {
    text:(t.textContent||'').trim().slice(0,10),
    ariaCurrent:t.getAttribute('aria-current'), ariaSelected:t.getAttribute('aria-selected'),
    color:s.color,bg:s.backgroundColor,
    indexColor:idx?getComputedStyle(idx).color:null, indexText:idx?idx.textContent:null,
    statusColor:st?getComputedStyle(st).color:null, statusData:st?st.getAttribute('data-status'):null,
    rect:{x:Math.round(r.x),w:Math.round(r.width)},
  };
}));
// composer + disabled send button geometry
const send=await p.evaluate(()=>{
  const btns=[...document.querySelectorAll('.workbench-composer button, button')].filter(x=>/发送消息/.test(x.textContent||''));
  return btns.map(x=>{const s=getComputedStyle(x);const r=x.getBoundingClientRect();return{text:(x.textContent||'').trim(),disabled:x.disabled,opacity:s.opacity,color:s.color,bg:s.backgroundColor,rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};});
});
console.log(JSON.stringify({tabs,send},null,1));
await b.close();
