// #08：正式 HTTP 与浏览器验收；资金预期独立计算，供应商仅为本机替身。
import { chromium, request } from "playwright-core";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { requestRegistrationCode } from "./verify-email-fixture.mjs";
let base=process.env.BASE_URL;
const output=process.env.V141_REPLAY_OUTPUT_DIR, clients=[],workflows=[],assertions=[],observations=[],pageErrors=[];
let pass=0,fail=0,browser;
function check(name,okay,actual) {assertions.push({name,okay:Boolean(okay),...(!okay?{actual}: {})}); console.log((okay?"✅ ":"❌ ")+name);if(okay)pass++;else fail++;}
function must(name,okay) {check(name,okay);if(!okay)throw Error(name);}
async function section(name,fn){const before=fail;try{await fn();}catch(error){check(name+"："+error.message,false);}if(fail===before)workflows.push(name);}
async function json(http,url,data){const r=data===undefined?await http.get(base+url):await http.post(base+url,{data});if(!r.ok())throw Error(url+" HTTP "+r.status());return r.json();}
async function login(http,email,password="credits-12345"){const csrfToken=(await json(http,"/api/auth/csrf")).csrfToken;await http.post(base+"/api/auth/callback/credentials",{form:{email,password,csrfToken,callbackUrl:base+"/projects"},headers:{"X-Auth-Return-Redirect":"1"}});return(await json(http,"/api/auth/session")).user;}
async function client(email,password="credits-12345",existing=false){const http=await request.newContext({timeout:60000});clients.push(http);let user;if(!existing){const r=await http.post(base+"/api/auth/register",{data:{email,password,code:await requestRegistrationCode(http,email)}});if(r.status()!==201)throw Error("注册失败");user=await r.json();}const signed=await login(http,email,password);return {http,user:user??signed,email,password};}
// 仅在隔离浏览器隐藏 Next dev 浮层，真实运行时错误仍由末尾断言拦截。
async function browserContext(actor) {
 const context=await browser.newContext({storageState:await actor.http.storageState()});
 await context.addInitScript(() => {
  const insert = () => { if (!document.head || document.getElementById("verify-hide-next-indicator")) return; const style = document.createElement("style"); style.id = "verify-hide-next-indicator"; style.textContent = "nextjs-portal { display: none !important; }"; document.head.appendChild(style); };
  new MutationObserver(insert).observe(document, { childList: true, subtree: true }); insert();
 });
 context.on("page",page=>page.on("pageerror",error=>pageErrors.push({message:error.message,url:page.url()})));
 return context;
}
async function fixture(url,data){const r=await fetch(new URL(url,process.env.V144_PROVIDER_FIXTURE_URL),{method:data?"POST":"GET",...(data?{headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}:{})});if(!r.ok)throw Error("替身控制失败");return r.json();}
async function poll(read,predicate,ms=10000){const end=Date.now()+ms;let v;do{v=await read();if(predicate(v))return v;await delay(80);}while(Date.now()<end);throw Error("等待可观察状态超时");}
function units(s){const [w,f=""]=s.split(".");return BigInt(w)*100000000n+BigInt(f.padEnd(8,"0"));}
function total(balance){return units(balance.gift.available)+units(balance.gift.reserved)+units(balance.purchased.available)+units(balance.purchased.reserved);}
async function grant(admin,actor,amount){return json(admin.http,"/api/admin/users/"+actor.user.id+"/credits",{requestId:randomUUID(),type:"grant",amount,reason:"会话积分隔离验收"});}
async function make(actor){const project=await json(actor.http,"/api/projects",{name:"积分验收"});const iteration=await json(actor.http,"/api/projects/"+project.id+"/iterations",{displayName:"积分验收"});return {actor,project,iteration};}
async function session(work,stage="analysis"){const value=await json(work.actor.http,"/api/iterations/"+work.iteration.id+"/stages/"+stage+"/sessions",{});return {id:value.session.id,stage,path:"/api/iterations/"+work.iteration.id+"/stages/"+stage+"/sessions/"+value.session.id+"/messages",work};}
async function generate(target,mode="normal",content="完整输入样本 😀",requestId=randomUUID()){await fixture("/control",{mode});const r=await target.work.actor.http.post(base+target.path,{data:{content,requestId}});return {response:r,body:await r.json(),requestId,content};}
async function statement(actor){return json(actor.http,"/api/credits");}
async function lifecycle(type){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{process.off("message",listener);reject(Error("隔离生命周期超时"));},60000);const listener=message=>{if(message.type!==type)return;clearTimeout(timer);process.off("message",listener);if(message.error)reject(Error(message.error));else resolve(message);};process.on("message",listener);process.send({type});});}
async function model(admin,call){const result=await json(admin.http,"/api/admin/model-requests?q="+call.id);return result.requests.find(row=>row.id===call.id);}
async function makeFile(work) {
 const target=await session(work);
 const generated=await generate(target,"context-document","文件润色积分验收");
 must("生成候选但尚未写入文件",generated.response.ok()&&(await json(work.actor.http,"/api/projects/"+work.project.id+"/files")).length===0);
 const candidate=generated.body.messages.find(m=>m.id===generated.body.assistantMessage.id).candidate;
 await json(work.actor.http,"/api/iterations/"+work.iteration.id+"/sessions/"+target.id+"/candidates/"+candidate.id,{action:"write",filename:"需求分析-润色积分.md",expectedOperation:"create"});
 const file=(await json(work.actor.http,"/api/projects/"+work.project.id+"/files")).find(f=>f.filename==="需求分析-润色积分.md");
 must("显式确认后文件存在",!!file);
 return {...work,file,target,path:"/api/projects/"+work.project.id+"/files/"+file.id+"/polish",filePath:"/api/projects/"+work.project.id+"/files/"+file.id};
}
async function polish(work,mode="normal",content="待润色的中文文档 😀",requestId=randomUUID()) {
 await fixture("/control",{mode});
 const response=await work.actor.http.post(base+work.path,{data:{content,requestId}});
 return {response,body:await response.json(),requestId,content};
}
async function editFile(work,content) {return json(work.actor.http,"/api/iterations/"+work.iteration.id+"/files/"+work.file.id,{projectId:work.project.id,action:"edit",content});}
try {
 if(!/^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE||"")||!process.env.V144_PROVIDER_FIXTURE_URL)throw Error("拒绝非隔离执行");
 const admin=await client(process.env.V144_ADMIN_EMAIL),actor=await client("polish-"+randomUUID()+"@test.local"),other=await client("other-"+randomUUID()+"@test.local");
 await grant(admin,actor,"4000");
 const work=await makeFile(await make(actor));
 browser=await chromium.launch({headless:true});
 let normal,normalCost;
 await section("admission-ownership-and-free-file-actions",async()=>{
  const before=await statement(actor),count=(await fixture("/stats")).count;
  const invalid=await actor.http.post(base+work.path,{data:{content:"缺少原身份"}});
  check("缺少请求身份被拦截",invalid.status()===400);
  check("其他账号不能调用或读取润色结果",(await other.http.post(base+work.path,{data:{content:"跨账号",requestId:randomUUID()}})).status()===404&&(await other.http.get(base+work.path)).status()===404);
  const anonymous=await request.newContext();clients.push(anonymous);
  check("未登录不能读取或调用润色",(await anonymous.get(base+work.path)).status()===401&&(await anonymous.post(base+work.path,{data:{content:"无登录",requestId:randomUUID()}})).status()===401);
  await json(actor.http,work.filePath);await json(actor.http,work.filePath+"/history");
  check("手工下载可用",(await actor.http.get(base+work.filePath+"/download")).ok());
  const manual=await editFile(work,"# 免费编辑\n\n普通保存不调用模型。");
  check("手工保存沿用内容修订",manual.content.includes("免费编辑"));
  const history=await json(actor.http,work.filePath+"/history");
  check("手工修改来源保持用户操作",history.changes.some(c=>c.operation==="edit"&&c.actor==="user"));
  const contextPath=work.target.path.replace(/messages$/,"context");
  await json(actor.http,contextPath,{fileId:work.file.id});
  check("手动上下文移除保持可用",(await actor.http.delete(base+contextPath,{data:{fileId:work.file.id}})).ok());
  const after=await statement(actor);
  check("查看下载编辑保存和上下文管理均免费",JSON.stringify(before.balance)===JSON.stringify(after.balance)&&before.total===after.total&&(await fixture("/stats")).count===count);
  await json(admin.http,"/api/admin/users/"+actor.user.id+"/credits",{requestId:randomUUID(),type:"correction",amount:"-"+after.balance.gift.available,reason:"验收零余额"});
  const denied=await actor.http.post(base+work.path,{data:{content:"被拦截输入必须保留",requestId:randomUUID()}});
  check("零积分402且没有访问上游或预留",denied.status()===402&&(await denied.json()).error.includes("输入已保留")&&(await fixture("/stats")).count===count&&(await statement(actor)).pendingCalls.length===0);
  const context=await browserContext(actor);const page=await context.newPage();
  await openEditor(page,work);
  const input=page.getByLabel("Markdown 正文");await input.fill("余额不足时本段草稿要保留");await page.getByRole("button",{name:"AI 润色",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"可用积分不足"}).waitFor();
  check("浏览器余额不足保留原输入",await input.inputValue()==="余额不足时本段草稿要保留"&&(await fixture("/stats")).count===count);
  await page.reload();await openEditor(page,work,false);
  check("刷新后被拒绝草稿仍可恢复",await input.inputValue()==="余额不足时本段草稿要保留");
  await context.close();await grant(admin,actor,"4000");
 });
 await section("shared-reservation-settlement-and-retry",async()=>{
  const before=await statement(actor),count=(await fixture("/stats")).count,requestId=randomUUID(),content="并发润色完整文档 😀";
  const target=await session(work);
  await fixture("/control",{mode:"hold"});await fixture("/control",{mode:"hold"});
  const p=actor.http.post(base+work.path,{data:{content,requestId}});
  const c=actor.http.post(base+target.path,{data:{content:"并发会话",requestId:randomUUID()}});
  const held=await poll(()=>statement(actor),s=>s.pendingCalls.filter(c=>c.state==="reserved").length===2);
  check("润色与会话共享账号余额及冻结合计",total(held.balance)===total(before.balance)&&held.pendingCalls.reduce((n,c)=>n+units(c.reserved),0n)===units(held.balance.gift.reserved));
  const current=await json(actor.http,work.path+"?requestId="+requestId);
  check("生成期间可查询本次预留",current.state==="running"&&current.creditCall.state==="reserved");
  check("同标识重复发送返回进行中",(await actor.http.post(base+work.path,{data:{content,requestId}})).status()===202);
  check("同标识改内容或跨入口均409",(await actor.http.post(base+work.path,{data:{content:"改内容",requestId}})).status()===409&&(await actor.http.post(base+target.path,{data:{content,requestId}})).status()===409);
  check("同文件不同标识不能重复生成",(await actor.http.post(base+work.path,{data:{content,requestId:randomUUID()}})).status()===409);
  const response=await p;normal={response,body:await response.json(),requestId,content};must("完整润色已结算",response.ok()&&normal.body.creditCall.state==="settled");
  const chat=await c;must("并行阶段会话正常完成",chat.ok());
  const row=await model(admin,normal.body.creditCall);normalCost=row.price.start.peak?"4.032":"2.016";
  check("润色按已知人民币账单乘2000计费",normal.body.creditCall.consumed===normalCost);
  const after=await statement(actor);
  check("并发结束余量释放且总余额守恒",after.balance.gift.reserved==="0"&&total(after.balance)===total(before.balance)-units(normalCost)*2n);
  check("润色实际输出预算为32768并计入全部输入",(await fixture("/stats")).calls.filter(r=>!r.stream).at(-1).maxTokens===32768&&row.maxOutputTokens===32768);
  const calls=(await fixture("/stats")).count;
  const repeated=await actor.http.post(base+work.path,{data:{content,requestId}});
  check("终态重试返回同一正文和费用且不重复调用",repeated.ok()&&JSON.stringify(await repeated.json())===JSON.stringify(normal.body)&&(await fixture("/stats")).count===calls&&calls===count+2);
  const file=await json(actor.http,work.filePath);
  check("生成结果不自动覆盖已确认文件",file.content.includes("免费编辑")&&!file.content.includes("测试润色"));
  check("个人账本保留关联文件与修订快照",after.entries.some(e=>e.businessType==="model_settle"&&e.context?.purpose==="polish"&&e.context.fileId===work.file.id&&e.context.filename===work.file.filename&&e.context.callId===normal.body.creditCall.id));
  observations.push({normal:normal.body,model:row,before:before.balance,after:after.balance});
 });
 await section("mixed-sources-and-competing-balance",async()=>{
  const purchase=await client(process.env.V144_LEGACY_EMAIL,process.env.V144_LEGACY_PASSWORD,true);
  await lifecycle("conversation-purchase-fixture");
  const mixed=await makeFile(await make(purchase));await grant(admin,purchase,"1");
  const before=await statement(purchase),result=await polish(mixed);
  must("购买来源与赠送混合润色成功",result.response.ok());
  const after=await statement(purchase),cost=units(result.body.creditCall.consumed);
  check("赠送优先消费，剩余购买支付并释放原来源",after.balance.gift.available==="0"&&after.balance.gift.reserved==="0"&&after.balance.purchased.reserved==="0"&&units(after.balance.purchased.available)===units(before.balance.purchased.available)-(cost-100000000n));
  check("混合来源消费按类型追溯",after.entries.some(e=>e.context?.callId===result.body.creditCall.id&&e.sourceKind==="gift"&&e.amount==="-1")&&after.entries.some(e=>e.context?.callId===result.body.creditCall.id&&e.sourceKind==="purchased"&&e.businessType==="model_settle"));
  const budgetActor=await client("budget-"+randomUUID()+"@test.local");await grant(admin,budgetActor,"1000");
  const limited=await makeFile(await make(budgetActor)),balance=await statement(budgetActor);
  await json(admin.http,"/api/admin/users/"+budgetActor.user.id+"/credits",{requestId:randomUUID(),type:"correction",amount:"-"+balance.balance.gift.available,reason:"竞争前清理可用积分"});await grant(admin,budgetActor,"600");
  const target=await session(limited),count=(await fixture("/stats")).count;
  await fixture("/control",{mode:"hold"});
  const races=await Promise.all([budgetActor.http.post(base+limited.path,{data:{content:"并行竞争润色",requestId:randomUUID()}}),budgetActor.http.post(base+target.path,{data:{content:"并行竞争会话",requestId:randomUUID()}})]);
  check("余额只够一笔时润色和会话竞争仅一笔成功",races.map(r=>r.status()).sort().join(",")==="200,402"&&(await fixture("/stats")).count===count+1);
  const final=await statement(budgetActor);check("余额竞争不产生负数或遗留冻结",units(final.balance.gift.available)>=0n&&final.balance.gift.reserved==="0");
 });
 await section("browser-lost-response-discard-reopen-and-manual-save",async()=>{
  const context=await browserContext(actor);const page=await context.newPage();
  await openEditor(page,work);const input=page.getByLabel("Markdown 正文");
  if(await page.getByRole("button",{name:"保留原文",exact:true}).count())await page.getByRole("button",{name:"保留原文",exact:true}).click();
  const before=await statement(actor),count=(await fixture("/stats")).count,keys=[];
  let lose=true,suppressQueries=true;
  await page.route("**"+work.path+"*",async route=>{
   if(route.request().method()==="GET"&&suppressQueries)return route.fulfill({status:200,contentType:"application/json",body:"{}"});
   if(route.request().method()!=="POST")return route.continue();
   keys.push(route.request().postDataJSON().requestId);
   if(!lose)return route.continue();
   lose=false;await route.fetch();return route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({error:"测试：结果响应丢失"})});
  });
  await input.fill("浏览器不确定结果需要原请求重试");await fixture("/control",{mode:"hold"});await page.getByRole("button",{name:"AI 润色",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"测试：结果响应丢失"}).waitFor();
  check("未知500保留草稿与请求身份",await input.inputValue()==="浏览器不确定结果需要原请求重试"&&await page.evaluate(({key,requestId})=>JSON.parse(sessionStorage.getItem(key)).pending.requestId===requestId,{key:"polish:"+actor.user.id+":"+work.project.id+":"+work.file.id,requestId:keys[0]}).catch(()=>false));
  await page.getByRole("button",{name:"重试原请求",exact:true}).click();
  await page.getByRole("button",{name:"保留原文",exact:true}).waitFor();suppressQueries=false;
  check("浏览器重试沿用原key只发生一次调用",keys.length===2&&keys[0]===keys[1]&&(await fixture("/stats")).count===count+1);
  const fee=page.locator('.project-file-edit [data-credit-state="settled"]');
  check("结果附近分别展示本次预留与实耗",(await fee.innerText()).includes("本次预留")&&(await fee.innerText()).includes("实际消耗"));
  await page.screenshot({path:join(output,"polish-settled-desktop.png"),fullPage:true});
  await page.getByRole("button",{name:"保留原文",exact:true}).click();
  const discarded=await statement(actor);
  check("不采用结果仍保留正常消费",total(discarded.balance)===total(before.balance)-units(normalCost)&&(await json(actor.http,work.filePath)).content.includes("免费编辑"));
  await page.getByRole("button",{name:"取消",exact:true}).click();await page.getByRole("button",{name:"关闭预览",exact:true}).click();
  await page.reload();await openEditor(page,work,false);await fee.waitFor();
  check("关闭刷新重新打开仍显示费用与未采用草稿",await input.inputValue()==="浏览器不确定结果需要原请求重试"&&await fee.isVisible()&&(await statement(actor)).total===discarded.total);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("button",{name:/^文件与上下文/}).click();
  await input.waitFor({state:"visible"});await fee.waitFor({state:"visible"});
  await page.screenshot({path:join(output,"polish-settled-mobile.png"),fullPage:true});
  check("390px编辑器无横向溢出",await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  const contentBeforeSave=(await json(actor.http,work.filePath)).content;
  await input.fill("# 浏览器手工保存\n\n无需再次调用模型。");await page.getByRole("button",{name:"保存修改",exact:true}).click();await page.getByText("修改已保存，可撤回到修改前的正文。",{exact:true}).waitFor();
  check("手工显式保存继续免费且修订成功",(await json(actor.http,work.filePath)).content.includes("浏览器手工保存")&&(await fixture("/stats")).count===count+1&&JSON.stringify((await statement(actor)).balance)===JSON.stringify(discarded.balance));
  await page.getByRole("button",{name:"撤回上次修改",exact:true}).click();
  await page.getByRole("button",{name:"确认撤回",exact:true}).click();
  await page.getByText("已撤回到上一版；本次撤回不能重做。",{exact:true}).waitFor();
  const restoredFile=await json(actor.http,work.filePath);
  await page.getByRole("button",{name:"编辑正文",exact:true}).click();await input.waitFor({state:"visible"});await fee.waitFor({state:"visible"});
  check("保存撤回再编辑与服务器原文一致且不恢复已保存草稿",restoredFile.content===contentBeforeSave&&await input.inputValue()===restoredFile.content);
  const afterRestore=await statement(actor);
  check("保存撤回和再编辑不新增模型调用或积分费用",(await fixture("/stats")).count===count+1&&JSON.stringify(afterRestore.balance)===JSON.stringify(discarded.balance)&&afterRestore.total===discarded.total);
  check("保存撤回再编辑仍保留已发生的润色费用",await fee.isVisible()&&(await fee.innerText()).includes("实际消耗"));
  await page.screenshot({path:join(output,"polish-restored-editor-mobile.png"),fullPage:true});
  await context.close();
 });
 await section("pending-faults-restart-and-profile-traces",async()=>{
  const pending=await polish(work,"missing");must("缺失可靠用量的完整预览仍可使用",pending.response.ok()&&pending.body.polished.includes("测试润色"));
  const call=pending.body.creditCall;
  check("润色进入同一持久待核对而非零消费",call.state==="pending"&&call.consumed===null);
  const before=await statement(actor),count=(await fixture("/stats")).count;
  const failed=await polish(work,"insufficient-system-resource");
  check("供应商失败免单释放且保留费用状态",failed.response.status()===500&&failed.body.state==="failed"&&failed.body.creditCall.state==="released"&&failed.body.creditCall.consumed==="0");
  const truncated=await polish(work,"output-length");
  check("截断不返回成功预览且免单",truncated.response.status()===500&&!truncated.body.polished&&truncated.body.creditCall.state==="released");
  const good=await polish(work,"tiny");check("小于1积分按实耗保留小数",good.body.creditCall.consumed===(normalCost==="4.032"?"0.02":"0.01"));
  const beforeRestart=await statement(actor),restart=await lifecycle("restart-credit-app");base=restart.base;
  const restored=await json(actor.http,work.path+"?requestId="+pending.requestId);
  check("真实应用重启后预览和待核对可恢复",restored.creditCall.id===call.id&&restored.creditCall.state==="pending"&&restored.polished===pending.body.polished&&JSON.stringify((await statement(actor)).balance)===JSON.stringify(beforeRestart.balance));
  const replayed=await actor.http.post(base+work.path,{data:{requestId:pending.requestId,content:pending.content}});
  check("重启重发不重新调用或重复消费",replayed.ok()&&(await replayed.json()).creditCall.id===call.id&&(await fixture("/stats")).count===count+3);
  const context=await browserContext(actor);const page=await context.newPage();await page.goto(base+"/profile");
  await page.getByLabel("未结算模型调用").waitFor();check("个人中心可见同一笔待核对",(await page.getByLabel("未结算模型调用").innerText()).includes(call.id));
  const detail=page.locator("details").filter({hasText:work.file.id}).first();await detail.locator("summary").click();
  check("个人流水可追踪润色文件",(await detail.innerText()).includes(work.file.filename));
  await page.screenshot({path:join(output,"polish-profile-traces.png"),fullPage:true});await context.close();
  const deletion=await actor.http.delete(base+"/api/projects/"+work.project.id);must("业务项目可删除",deletion.ok());
  const remaining=await statement(actor);check("删除项目不抹除待核对或文件资金快照",remaining.pendingCalls.some(c=>c.id===call.id)&&remaining.entries.some(e=>e.context?.fileId===work.file.id)&&JSON.stringify(remaining.balance)===JSON.stringify(beforeRestart.balance));
  observations.push({pending:pending.body,balance:before.balance,restored:restored.creditCall});
 });
} catch(error) {check("场景准备失败："+error.message,false);}
finally {await browser?.close();check("浏览器无运行时异常",pageErrors.length===0,pageErrors);for(const http of clients)await http.dispose();await writeFile(join(output,"scenario-summary.json"),JSON.stringify({pass,fail,aiMode:"replay",applicationAiMode:"live",fixture:true,live:false,realLlmCostCny:"0",workflows,assertions,observations,pageErrors},null,2));console.log("结果: "+pass+" 通过, "+fail+" 失败");}
async function openEditor(page,work,navigate=true) {
 if(navigate)await page.goto(base+"/projects/"+work.project.id+"/iterations/"+work.iteration.id,{timeout:120000});
 await page.getByRole("tab",{name:/项目文件/}).click();
 await page.locator("button.project-tree-name").filter({hasText:work.file.filename.split("/").at(-1)}).click();
 await page.getByRole("button",{name:"编辑正文",exact:true}).click();
 await poll(()=>page.getByRole("button",{name:"AI 润色",exact:true}).isEnabled(),v=>v);
}
process.exit(fail>0?1:0);
