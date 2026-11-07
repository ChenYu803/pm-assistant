// #07：正式 HTTP 与浏览器验收；资金预期独立计算，供应商仅为本机替身。
import { chromium, request } from "playwright-core";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { settleConversationCredits } from "../src/lib/conversation-credits.ts";
import { closeMysqlPoolForTests } from "../src/lib/mysql.ts";
import { requestRegistrationCode } from "./verify-email-fixture.mjs";
let base=process.env.BASE_URL;
const output=process.env.V141_REPLAY_OUTPUT_DIR, clients=[],workflows=[],assertions=[],observations=[];
let pass=0,fail=0,browser;
function check(name,okay,actual) {assertions.push({name,okay:Boolean(okay),...(!okay?{actual}: {})}); console.log((okay?"✅ ":"❌ ")+name);if(okay)pass++;else fail++;}
function must(name,okay) {check(name,okay);if(!okay)throw Error(name);}
async function section(name,fn){const before=fail;try{await fn();}catch(error){check(name+"："+error.message,false);}if(fail===before)workflows.push(name);}
async function json(http,url,data){const r=data===undefined?await http.get(base+url):await http.post(base+url,{data});if(!r.ok())throw Error(url+" HTTP "+r.status());return r.json();}
async function login(http,email,password="credits-12345"){const csrfToken=(await json(http,"/api/auth/csrf")).csrfToken;await http.post(base+"/api/auth/callback/credentials",{form:{email,password,csrfToken,callbackUrl:base+"/projects"},headers:{"X-Auth-Return-Redirect":"1"}});return(await json(http,"/api/auth/session")).user;}
async function client(email,password="credits-12345",existing=false){const http=await request.newContext({timeout:60000});clients.push(http);let user;if(!existing){const r=await http.post(base+"/api/auth/register",{data:{email,password,code:await requestRegistrationCode(http,email)}});if(r.status()!==201)throw Error("注册失败");user=await r.json();}const signed=await login(http,email,password);return {http,user:user??signed,email,password};}
async function fixture(url,data){const r=await fetch(new URL(url,process.env.V144_PROVIDER_FIXTURE_URL),{method:data?"POST":"GET",...(data?{headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}:{})});if(!r.ok)throw Error("替身控制失败");return r.json();}
async function poll(read,predicate,ms=10000){const end=Date.now()+ms;let v;do{v=await read();if(predicate(v))return v;await delay(80);}while(Date.now()<end);throw Error("等待可观察状态超时");}
function units(s){const [w,f=""]=s.split(".");return BigInt(w)*100000000n+BigInt(f.padEnd(8,"0"));}
function text(n){const f=(n%100000000n).toString().padStart(8,"0").replace(/0+$/,"");return(n/100000000n).toString()+(f?"."+f:"");}
function total(balance){return units(balance.gift.available)+units(balance.gift.reserved)+units(balance.purchased.available)+units(balance.purchased.reserved);}
async function grant(admin,actor,amount){return json(admin.http,"/api/admin/users/"+actor.user.id+"/credits",{requestId:randomUUID(),type:"grant",amount,reason:"会话积分隔离验收"});}
async function make(actor){const project=await json(actor.http,"/api/projects",{name:"积分验收"});const iteration=await json(actor.http,"/api/projects/"+project.id+"/iterations",{displayName:"积分验收"});return {actor,project,iteration};}
async function session(work,stage="analysis"){const value=await json(work.actor.http,"/api/iterations/"+work.iteration.id+"/stages/"+stage+"/sessions",{});return {id:value.session.id,stage,path:"/api/iterations/"+work.iteration.id+"/stages/"+stage+"/sessions/"+value.session.id+"/messages",work};}
async function generate(target,mode="normal",content="完整输入样本 😀",requestId=randomUUID()){await fixture("/control",{mode});const r=await target.work.actor.http.post(base+target.path,{data:{content,requestId}});return {response:r,body:await r.json(),requestId,content};}
async function statement(actor){return json(actor.http,"/api/credits");}
async function history(target){return json(target.work.actor.http,target.path);}
async function lifecycle(type){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{process.off("message",listener);reject(Error("隔离生命周期超时"));},60000);const listener=message=>{if(message.type!==type)return;clearTimeout(timer);process.off("message",listener);if(message.error)reject(Error(message.error));else resolve(message);};process.on("message",listener);process.send({type});});}
async function model(admin,call){const result=await json(admin.http,"/api/admin/model-requests?q="+call.id);return result.requests.find(row=>row.id===call.id);}
try{
 if(!/^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE||"")||!process.env.V144_PROVIDER_FIXTURE_URL)throw Error("拒绝非隔离执行");
 const admin=await client(process.env.V144_ADMIN_EMAIL),actor=await client("credits-"+randomUUID()+"@test.local");
 const work=await make(actor),first=await session(work);
 await section("zero-balance-and-browser",async()=>{
  const before=(await fixture("/stats")).count;
  const zero=await actor.http.post(base+first.path,{data:{content:"零余额输入必须保留",requestId:randomUUID()}});
  check("零余额返回402与兑换充值指引",zero.status()===402&&(await zero.text()).includes("兑换邀请码"));
  const ownAdmin=await session(await make(admin));
  check("管理员没有隐藏免费通道",(await admin.http.post(base+ownAdmin.path,{data:{content:"管理员零余额",requestId:randomUUID()}})).status()===402);
  check("零余额没有访问供应商",(await fixture("/stats")).count===before);
  check("零余额输入已持久保留",(await history(first)).messages.some(row=>row.role==="user"&&row.content==="零余额输入必须保留"));
  browser=await chromium.launch({headless:true,channel:"msedge"});
  const context=await browser.newContext({storageState:await actor.http.storageState()});const page=await context.newPage();
  await page.goto(base+"/projects/"+work.project.id+"/iterations/"+work.iteration.id,{timeout:120000});
  await page.getByRole("button",{name:/零余额输入必须保留/}).first().click();
  const input=page.getByRole("textbox",{name:"输入消息"});await input.fill("浏览器零余额原文");await page.getByRole("button",{name:"发送消息",exact:true}).click();
  await page.getByText(/可用积分不足以支持本次生成/).first().waitFor();
  check("浏览器余额不足保留输入",await input.inputValue()==="浏览器零余额原文");
  check("工作台显示账号总余额入口",await page.getByRole("link",{name:"账号积分，查看个人中心"}).count()===1);
  check("浏览器拒绝与页面浏览仍不访问上游",(await fixture("/stats")).count===before);
  await page.screenshot({path:join(output,"credits-zero-desktop.png"),fullPage:true});await context.close();
 });
 await grant(admin,actor,"4000");
 let settledCall,normalCost;
 await section("reservation-settlement-and-idempotency",async()=>{
  const target=await session(work),requestId=randomUUID();
  const prepared=await generate(target,"context-document","完整输入样本 准备上下文");
  const candidate=prepared.body.messages.find(m=>m.id===prepared.body.assistantMessage.id).candidate;
  must("准备完整文件候选",candidate?.status==="pending");
  await json(actor.http,"/api/iterations/"+work.iteration.id+"/sessions/"+target.id+"/candidates/"+candidate.id,{action:"write",filename:"需求分析-积分样本.md",expectedOperation:"create"});
  const file=(await json(actor.http,"/api/projects/"+work.project.id+"/files")).find(f=>f.filename==="需求分析-积分样本.md");
  await json(actor.http,target.path.replace(/messages$/,"context"),{fileId:file.id});
  const before=await statement(actor);
  const started=(await fixture("/stats")).count;
  await fixture("/control",{mode:"hold"});
  const pending=actor.http.post(base+target.path,{data:{content:"完整输入样本 😀",requestId}});
  const held=await poll(()=>statement(actor),v=>v.pendingCalls.length>0);
  check("调用进行中冻结且余额总额守恒",units(held.balance.gift.reserved)>0n&&total(held.balance)===total(before.balance));
  await settleConversationCredits(held.pendingCalls.find(c=>c.state==="reserved").id);
  check("进行中结算重试不提前释放",(await statement(actor)).balance.gift.reserved===held.balance.gift.reserved);
  const conflict=await actor.http.post(base+target.path,{data:{content:"同会话并发",requestId:randomUUID()}});
  check("同会话互斥返回409",conflict.status()===409);
  const response=await pending,body=await response.json();must("正常生成完成",response.ok()&&body.assistantMessage?.status==="completed");
  settledCall=body.messages.find(row=>row.id===body.assistantMessage.id).creditCall;
  const row=await model(admin,settledCall),peak=row.price.start.peak;
  normalCost=peak?"4.032":"2.016";
  check("独立账单按缓存命中与输出结算",settledCall.state==="settled"&&settledCall.consumed===normalCost);
  const after=await statement(actor);check("释放余量且资金守恒",after.balance.gift.reserved==="0"&&total(after.balance)===total(before.balance)-units(normalCost));
  check("来源优先消费赠送",after.balance.purchased.available==="0"&&after.entries.some(e=>e.businessType==="model_settle"&&e.sourceKind==="gift"&&e.amount==="-"+normalCost));
  const repeat=await actor.http.post(base+target.path,{data:{content:"完整输入样本 😀",requestId}});
  check("重复提交返回原回复",repeat.ok()&&(await repeat.json()).assistantMessage.id===body.assistantMessage.id);
  check("同标识改内容被拒绝",(await actor.http.post(base+target.path,{data:{content:"改了输入",requestId}})).status()===409);
  check("互斥与重发只有一次供应商调用",(await fixture("/stats")).count===started+1);
  await Promise.all([settleConversationCredits(settledCall.id),settleConversationCredits(settledCall.id)]);
  const retried=await statement(actor);
  check("真实并发结算重试不新增消费或流水",retried.total===after.total&&JSON.stringify(retried.balance)===JSON.stringify(after.balance));
  const sent=(await fixture("/stats")).calls.at(-1);
  const expectedReservation=(BigInt(sent.inputBytes+sent.messageCount*256+4096)*400000n+BigInt(sent.maxTokens)*1600000n);
  check("完整系统与历史输入进入保守预算",settledCall.reserved===text(expectedReservation)&&sent.messageCount>=2&&sent.maxTokens===16384);
  check("实际完整注入文件和系统消息计入预算",sent.fullContextIncluded&&sent.inputHashes.includes(createHash("sha256").update(prepared.body.assistantMessage.content).digest("hex")));
  const second=await generate(target,"tiny","加入历史后的第二轮");const secondCall=second.body.messages.find(m=>m.id===second.body.assistantMessage?.id)?.creditCall;
  check("不足1积分不向上取整",secondCall?.consumed===(peak?"0.02":"0.01"));
  check("第二轮实际发送了完整历史",(await fixture("/stats")).calls.at(-1).messageCount>sent.messageCount);
  const limitedOutput=await generate(await session(work),"output-length","长文达到输出限制");
  check("达到输出上限明确提示未完成且不静默保存",limitedOutput.response.status()===502&&JSON.stringify(limitedOutput.body).includes("达到输出上限")&&limitedOutput.body.messages.find(m=>m.role==="assistant").creditCall.state==="released");
  const failedTarget=await session(work),failed=await generate(failedTarget,"failed-known","故障结果幂等");
  const failCount=(await fixture("/stats")).count,failedHistory=await history(failedTarget),failedCall=failedHistory.messages.find(m=>m.role==="assistant").creditCall;
  check("供应商故障释放预留且不扣分",failed.response.status()===502&&failedCall.state==="released"&&failedCall.consumed==="0");
  const failedAgain=await actor.http.post(base+failedTarget.path,{data:{content:failed.content,requestId:failed.requestId}});
  check("故障请求重发仍返回失败且不访问上游",failedAgain.status()===502&&(await fixture("/stats")).count===failCount);
  const context=await browser.newContext({storageState:await actor.http.storageState()}),page=await context.newPage();
  await page.goto(base+"/projects/"+work.project.id+"/iterations/"+work.iteration.id,{timeout:120000});
  await page.getByRole("button",{name:/完整输入样本/}).first().click();
  let lostResponse=true;const requestKeys=[];
  await page.route("**"+target.path,async route=>{
   if(route.request().method()!=="POST")return route.continue();
   requestKeys.push(route.request().postDataJSON().requestId);
   if(!lostResponse)return route.continue();
   lostResponse=false;await route.fetch();await route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({error:"测试：已提交结果暂不可确认"})});
  });
  await fixture("/control",{mode:"hold"});const browserCount=(await fixture("/stats")).count;
  const input=page.getByRole("textbox",{name:"输入消息"}),send=page.getByRole("button",{name:"发送消息",exact:true});
  await input.fill("浏览器结果不确定重试");await send.click();
  await page.locator('[data-credit-state="reserved"]').first().waitFor();check("生成期间展示本次预留",true);
  await page.getByText("测试：已提交结果暂不可确认",{exact:true}).waitFor();
  const retryStorageKey="stage-generation-request:"+target.id,retryContent="浏览器结果不确定重试";
  await poll(()=>input.inputValue(),v=>v==="");
  const savedRetry=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)??"null"),retryStorageKey);
  check("500后历史确认消费草稿并保留原请求身份",await input.inputValue()===""&&savedRetry?.requestId===requestKeys[0]&&savedRetry?.identity===JSON.stringify([retryContent,null,null]));
  const confirmedHistory=await history(target),beforeRetry=await statement(actor);
  check("响应丢失后历史仅保存一条本次用户消息",confirmedHistory.messages.filter(m=>m.role==="user"&&m.content===retryContent).length===1);
  await input.fill(retryContent);await send.click();
  await poll(()=>input.inputValue(),v=>v==="");
  await poll(()=>page.evaluate(key=>sessionStorage.getItem(key),retryStorageKey),v=>v===null);
  const afterRetry=await statement(actor),retriedHistory=await history(target);
  check("500重试沿用标识且不重复调用供应商",requestKeys.length===2&&requestKeys[0]===requestKeys[1]&&(await fixture("/stats")).count===browserCount+1);
  check("500重试不重复保存用户消息",retriedHistory.messages.filter(m=>m.role==="user"&&m.content===retryContent).length===1);
  check("500重试不重复扣费或新增流水",JSON.stringify(afterRetry.balance)===JSON.stringify(beforeRetry.balance)&&JSON.stringify(afterRetry.entries.map(e=>e.id).sort())===JSON.stringify(beforeRetry.entries.map(e=>e.id).sort()));
  await context.close();
  observations.push({normalCost,settledCall,heldBalance:held.balance,afterBalance:after.balance,requestKeys});
 });
 await section("mixed-sources-and-shared-concurrency",async()=>{
  const legacy=await client(process.env.V144_LEGACY_EMAIL,process.env.V144_LEGACY_PASSWORD,true);
  const purchased=await lifecycle("conversation-purchase-fixture");check("购买来源夹具明确只作用于隔离账号",purchased.fixture.accountId===legacy.user.id);
  await grant(admin,legacy,"0.0005");const mixed=await generate(await session(await make(legacy)),"tiny");
  const call=mixed.body.messages.find(m=>m.id===mixed.body.assistantMessage?.id)?.creditCall;must("混合来源生成成功",mixed.response.ok()&&call?.state==="settled");
  const after=await statement(legacy),cost=units(call.consumed);
  check("混合来源先耗尽赠送，再消费购买",after.balance.gift.available==="0"&&after.balance.gift.reserved==="0"&&units(after.balance.purchased.available)===200000000000n-cost+50000n&&after.balance.purchased.reserved==="0");
  for(const entry of after.entries.filter(e=>e.businessType.startsWith("model_"))) {
   const sum=entry.allocations.reduce((n,a)=>n+units(a.amount),0n),kind=entry.sourceKind;
   check("逐笔流水快照与来源变动一致："+entry.businessType+":"+kind,units(entry.after[kind].reserved)-units(entry.before[kind].reserved)===(entry.businessType==="model_reserve"?sum:-sum)&&total(entry.after)-total(entry.before)===(entry.businessType==="model_settle"?-sum:0n));
  }
  const spend=after.entries.filter(e=>e.businessType==="model_settle");check("两类来源消费可逐笔核对",spend.length===2&&spend.find(e=>e.sourceKind==="gift")?.amount==="-0.0005");
  const a=await session(work),b=await session(work),before=await statement(actor);
  const start=(await fixture("/stats")).count;
  await fixture("/control",{mode:"hold"});await fixture("/control",{mode:"hold"});
  const pending=[a,b].map(t=>actor.http.post(base+t.path,{data:{content:"并行调用",requestId:randomUUID()}}));
  const held=await poll(()=>statement(actor),v=>v.pendingCalls.filter(c=>c.state==="reserved").length===2);
  const sum=held.pendingCalls.reduce((n,c)=>n+units(c.reserved),0n);
  check("不同会话真实并行共享账号冻结总额",sum===units(held.balance.gift.reserved)&&total(held.balance)===total(before.balance));
  const responses=await Promise.all(pending);check("已预留的并行调用都完成",responses.every(r=>r.ok())&&(await fixture("/stats")).count===start+2);
  const limited=await client("limited-"+randomUUID()+"@test.local");const lw=await make(limited),la=await session(lw),lb=await session(lw);
  await grant(admin,limited,text(units(settledCall.reserved)+1000000000n));await fixture("/control",{mode:"hold"});
  const count=(await fixture("/stats")).count;
  const races=await Promise.all([la,lb].map(t=>limited.http.post(base+t.path,{data:{content:"竞争余额",requestId:randomUUID()}})));
  check("共享余额竞争只有一笔获准，另一笔402",races.map(r=>r.status()).sort().join(",")==="200,402");
  check("余额不足请求不抵达上游",(await fixture("/stats")).count===count+1);
  const limitedBalance=await statement(limited);check("竞争后没有负余额或遗留冻结",units(limitedBalance.balance.gift.available)>=0n&&limitedBalance.balance.gift.reserved==="0");
 });
 await section("pending-restart-delete-and-browser",async()=>{
  const target=await session(work),missing=await generate(target,"missing","供应商缺用量");must("无可靠用量仍保存正常回复",missing.response.ok());
  const call=missing.body.messages.find(m=>m.id===missing.body.assistantMessage.id).creditCall;
  check("缺失用量持久待核对，不估算扣分",call.state==="pending"&&call.consumed===null);
  const excess=await generate(await session(work),"over-budget","用量超出预留边界");
  const excessCall=excess.body.messages.find(m=>m.id===excess.body.assistantMessage.id).creditCall;
  check("超出预算边界保留待核对且不扣负余额",excess.response.ok()&&excessCall.state==="pending"&&excessCall.reason==="budget_exceeded"&&excessCall.consumed===null);
  const before=await statement(actor),count=(await fixture("/stats")).count;
  const known=await generate(await session(work),"tiny","其他可用积分继续使用");check("待核对不阻止其他会话使用剩余积分",known.response.ok());
  const restartBefore=await statement(actor),restarted=await lifecycle("restart-credit-app");base=restarted.base;
  const restored=await statement(actor);check("实际应用重启后余额与待核对不丢失",JSON.stringify(restored.balance)===JSON.stringify(restartBefore.balance)&&restored.pendingCalls.some(c=>c.id===call.id&&c.reserved===call.reserved));
  const again=await actor.http.post(base+target.path,{data:{content:missing.content,requestId:missing.requestId}});
  check("重启后原请求重发不再次生成或扣费",again.ok()&&(await fixture("/stats")).count===count+1);
  const context=await browser.newContext({storageState:await actor.http.storageState()});const page=await context.newPage();
  await page.goto(base+"/projects/"+work.project.id+"/iterations/"+work.iteration.id,{timeout:120000});
  await page.getByRole("button",{name:/供应商缺用量/}).first().click();
  await page.getByText(/待核对，预留暂未释放/).first().waitFor();
  const summary=page.getByRole("link",{name:"账号积分，查看个人中心"});await expectText(summary,"账号冻结 "+restored.balance.gift.reserved+" 积分");
  check("工作台刷新从服务端恢复全账号冻结总额",(await summary.innerText()).includes(restored.balance.gift.reserved));
  await page.screenshot({path:join(output,"credits-pending-desktop.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(output,"credits-pending-mobile.png"),fullPage:true});
  check("390px工作台无页面横向溢出",await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.goto(base+"/profile");await page.getByLabel("未结算模型调用").waitFor();check("个人中心显示同一待核对记录",(await page.getByLabel("未结算模型调用").innerText()).includes(call.id));
  await page.screenshot({path:join(output,"credits-profile-mobile.png"),fullPage:true});await context.close();
  const removed=await actor.http.delete(base+"/api/iterations/"+work.iteration.id);check("删除业务迭代成功",removed.ok());
  const statementAfterDelete=await statement(actor);check("业务删除保留资金与追溯快照",statementAfterDelete.pendingCalls.some(c=>c.id===call.id)&&statementAfterDelete.entries.some(e=>e.context?.iterationId===work.iteration.id&&e.context?.projectName==="积分验收")&&JSON.stringify(statementAfterDelete.balance)===JSON.stringify(restored.balance));
  observations.push({pendingCall:call,before:before.balance,restored:restored.balance});
 });
}catch(error){check("场景准备失败："+error.message,false);}
finally{await closeMysqlPoolForTests();await browser?.close();for(const http of clients)await http.dispose();await writeFile(join(output,"scenario-summary.json"),JSON.stringify({pass,fail,aiMode:"replay",applicationAiMode:"live",fixture:true,live:false,realLlmCostCny:"0",workflows,assertions,observations},null,2));console.log("结果: "+pass+" 通过, "+fail+" 失败");}
async function expectText(locator,value){await poll(()=>locator.innerText(),text=>text.includes(value));}
process.exit(fail>0?1:0);
