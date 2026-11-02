import { chromium } from 'playwright-core';
const EXE='D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const b=await chromium.launch({executablePath:EXE,headless:false});
const c=await b.newContext({viewport:{width:1440,height:1000}});
const p=await c.newPage();
await p.setContent('<div id=a style="border:1px solid red;width:100px;height:10px"></div><div id=b style="border:2px solid red;width:100px;height:10px"></div>');
console.log(JSON.stringify(await p.evaluate(()=>({
  dpr: devicePixelRatio,
  one: getComputedStyle(document.getElementById('a')).borderTopWidth,
  two: getComputedStyle(document.getElementById('b')).borderTopWidth,
  screenScale: window.screen?.width, inner: window.innerWidth,
})),null,1));
await b.close();
