// #09：停止与故障结算专项；资金预期独立计算，供应商仅为本机替身。
import { startModelRequest, assertModelProcessingActive, completeModelProcessing, markModelProcessingFailure } from "../src/lib/model-metering.ts";
import { conversationBudget } from "../src/lib/conversation-credit-budget.ts";
import { lockCreditUsers } from "../src/lib/credits-ledger.ts";
import { requestModelStop, stopPolishRequest } from "../src/lib/model-request-control.ts";
import { settleConversationCredits } from "../src/lib/conversation-credits.ts";
import { getMysqlPool, closeMysqlPoolForTests } from "../src/lib/mysql.ts";
import { chromium, request } from "playwright-core";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { requestRegistrationCode } from "./verify-email-fixture.mjs";
let base=process.env.BASE_URL;
const output=process.env.V141_REPLAY_OUTPUT_DIR, clients=[],workflows=[],workflowResults=[],assertions=[],observations=[],pageErrors=[];
let pass=0,fail=0,browser;
function check(name,okay,actual) {assertions.push({name,okay:Boolean(okay),...(!okay?{actual}: {})}); console.log((okay?"✅ ":"❌ ")+name);if(okay)pass++;else fail++;}
function must(name,okay) {check(name,okay);if(!okay)throw Error(name);}
async function section(name,fn) {
 if(process.env.V144_STOP_BILLING_WORKFLOW&&name!==process.env.V144_STOP_BILLING_WORKFLOW)return;
 const beforePass=pass,beforeFail=fail;
 try {await fn();}catch(error){check(name+"："+error.message,false,{stack:error.stack});}
 const result={name,pass:pass-beforePass,fail:fail-beforeFail};
 workflowResults.push(result);
 if(result.fail===0)workflows.push(name);
 // 每组结束落盘摘要，保留故障定位信号，不向主会话灌入对话输出。
 await writeFile(join(output,"scenario-progress.json"),JSON.stringify({pass,fail,workflowResults},null,2));
}
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
async function lifecycle(type,payload={}){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{process.off("message",listener);reject(Error("隔离生命周期超时"));},60000);const listener=message=>{if(message.type!==type)return;clearTimeout(timer);process.off("message",listener);if(message.error)reject(Error(message.error));else resolve(message);};process.on("message",listener);process.send({type,...payload});});}
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
 if(!/^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE||""))throw Error("拒绝非隔离执行");
 const admin=await client(process.env.V144_ADMIN_EMAIL),actor=await client("stop-"+randomUUID()+"@test.local");
 await grant(admin,actor,"10000");
 const work=await makeFile(await make(actor));
 await section("polish-explicit-stop-pending",async()=>{
  const requestId=randomUUID();
  await fixture("/control",{mode:"hold"});
  const count=(await fixture("/stats")).count;
  const running=actor.http.post(base+work.path,{data:{content:"主动停止润色",requestId}});
  await poll(()=>fixture("/stats"),s=>s.count===count+1);
  const stopped=await actor.http.delete(base+work.path,{data:{requestId}});
  await running;
  must("润色有独立主动停止入口",stopped.ok());
  const result=await poll(()=>json(actor.http,work.path+"?requestId="+requestId),r=>r.state!=="running");
  check("主动停止缺用量保持待核对",result.state==="stopped"&&result.creditCall.state==="pending");
  check("后台持久区分主动停止",(await model(admin,result.creditCall)).status==="stopped");
 });

 await section("stage-stop-reliable-and-unknown",async()=>{
  for(const mode of ["stop-known","stop-unknown"]) {
   const target=await session(work),requestId=randomUUID(),content="会话主动停止："+mode;
   const before=await statement(actor),plan=await fixture("/control",{mode});
   const running=actor.http.post(base+target.path,{data:{content,requestId}});
   await poll(()=>fixture("/stats"),s=>s.calls.some(c=>c.providerId===plan.providerId&&c.phase===(mode==="stop-known"?"usage-sent":"text-sent")));
   const stopPath="/api/iterations/"+work.iteration.id+"/sessions/"+target.id+"/stop";
   const results=await Promise.all([actor.http.post(base+stopPath),actor.http.post(base+stopPath)]);
   check(mode+"重复停止至少一次确认",results.some(r=>r.ok())&&results.every(r=>[200,409].includes(r.status())));
   await running;
   const history=await json(actor.http,target.path),reply=history.messages.find(m=>m.role==="assistant");
   const call=reply.creditCall,row=await model(admin,call),after=await statement(actor);
   check(mode+"持久状态是主动停止",reply.status==="failed"&&row.status==="stopped"&&!row.websiteBorne);
   if(mode==="stop-known") {
    const expected=row.price.start.peak?"4.032":"2.016";
    check("停止可靠用量只消费实际费用",call.state==="settled"&&call.consumed===expected&&call.reason==="stopped_confirmed");
    check("停止后消费与余额守恒",total(before.balance)-total(after.balance)===units(expected));
   } else check("停止缺用量不猜扣不释放",call.state==="pending"&&call.consumed===null&&total(before.balance)===total(after.balance));
   const count=(await fixture("/stats")).count;
   await actor.http.post(base+target.path,{data:{content,requestId}});
   await settleConversationCredits(call.id);await settleConversationCredits(call.id);
   check(mode+"重试与重复结算不再调用或改账",(await fixture("/stats")).count===count&&JSON.stringify((await statement(actor)).balance)===JSON.stringify(after.balance));
   const closed=await poll(()=>fixture("/stats"),s=>s.calls.find(c=>c.providerId===plan.providerId)?.closed);
   check(mode+"取消及时传播供应商",closed.calls.find(c=>c.providerId===plan.providerId).phase!=="stop-timeout");
   observations.push({mode,call,row});
  }
 });
 await section("polish-known-stop-completion-race",async()=>{
  const requestId=randomUUID(),content="完成响应与停止竞争";
  const plan=await fixture("/control",{mode:"hold"});
  const running=actor.http.post(base+work.path,{data:{content,requestId}});
  await poll(()=>fixture("/stats"),s=>s.calls.some(c=>c.providerId===plan.providerId));
  // 账号锁屏障使停止先排队，完整供应商用量随后到达；不修改应用状态。
  await lifecycle("stop-account-lock",{userId:actor.user.id});
  let stopping;
  try {
   stopping=actor.http.delete(base+work.path,{data:{requestId}});
   await poll(()=>fixture("/stats"),s=>s.calls.find(c=>c.providerId===plan.providerId)?.phase==="done");
   await delay(150);
  } finally {await lifecycle("stop-account-unlock");}
  await stopping;await running;
  const result=await json(actor.http,work.path+"?requestId="+requestId),row=await model(admin,result.creditCall);
  check("润色停止遇到可靠完整用量按实结算",result.state==="stopped"&&result.creditCall.state==="settled"&&result.creditCall.reason==="stopped_confirmed"&&result.creditCall.consumed===(row.price.start.peak?"4.032":"2.016"));
  const before=await statement(actor),count=(await fixture("/stats")).count;
  await Promise.all([actor.http.delete(base+work.path,{data:{requestId}}),actor.http.delete(base+work.path,{data:{requestId}})]);
  await actor.http.post(base+work.path,{data:{content,requestId}});
  check("润色重复取消和重发保持同一费用",JSON.stringify((await statement(actor)).balance)===JSON.stringify(before.balance)&&(await fixture("/stats")).count===count);
  // 正常完成获胜后，迟到停止同样不能把已结算变为停止或免单。
  const normal=await polish(work),normalBefore=await statement(actor);
  await actor.http.delete(base+work.path,{data:{requestId:normal.requestId}});
  const completed=await json(actor.http,work.path+"?requestId="+normal.requestId);
  check("正常结束先提交则停止不改终态",completed.state==="completed"&&completed.creditCall.state==="settled"&&JSON.stringify((await statement(actor)).balance)===JSON.stringify(normalBefore.balance));
 });
 await section("provider-failures-release-and-retain-cost",async()=>{
  for(const entry of ["stage","polish"])for(const mode of ["request-error","failed-known","failed-unknown","disconnect",...(entry==="stage"?["interrupted"]:[])]) {
   const before=await statement(actor),target=entry==="stage"?await session(work):work;
   const result=entry==="stage"?await generate(target,mode):await polish(work,mode);
   const call=entry==="stage"?result.body.messages?.find(m=>m.role==="assistant")?.creditCall:result.body.creditCall;
   must(entry+" "+mode+" 返回持久账单",!!call);
   const row=await model(admin,call),after=await statement(actor);
   check(entry+" "+mode+" 故障立即免单释放自身预留",call.state==="released"&&call.consumed==="0"&&total(after.balance)===total(before.balance)&&JSON.stringify(after.balance)===JSON.stringify(before.balance));
   check(entry+" "+mode+" 后台保留故障与成本分类",row.websiteBorne&&["failed","interrupted"].includes(row.status)&&(mode!=="failed-known"||row.costCny!==null));
   const count=(await fixture("/stats")).count;
   await actor.http.post(base+target.path,{data:{content:result.content,requestId:result.requestId}});
   check(entry+" "+mode+" 错误重试无重复费用",(await fixture("/stats")).count===count&&JSON.stringify((await statement(actor)).balance)===JSON.stringify(after.balance));
  }
 });
 await section("site-write-failures-release-and-retain-cost",async()=>{
  for(const target of ["settlement","polish"]) {
   await lifecycle("stop-write-fault",{target});
   const before=await statement(actor);
   let result;
   try {result=await polish(work);}finally {await lifecycle("stop-clear-fault");}
   const row=await model(admin,result.body.creditCall),after=await statement(actor);
   check(target+"写入失败原子免单且不遗留预留",result.body.state==="failed"&&result.body.creditCall.state==="released"&&JSON.stringify(after.balance)===JSON.stringify(before.balance));
   check(target+"写入失败仍保留网站真实成本",row.status==="failed"&&row.websiteBorne&&row.costCny!==null);
  }
 });
 await section("late-cost-after-explicit-failure",async()=>{
  const requestId=randomUUID();await fixture("/control",{mode:"hold"});
  const before=await statement(actor),running=actor.http.post(base+work.path,{data:{content:"明确故障后迟到供应商成本",requestId}});
  const current=await poll(()=>json(actor.http,work.path+"?requestId="+requestId),v=>v.creditCall?.state==="reserved");
  // 注入网站处理失败，执行正式免单服务；上游返回未被伪造，随后收到真实替身用量。
  await markModelProcessingFailure(current.creditCall.id);
  const freed=await json(actor.http,work.path+"?requestId="+requestId);
  check("明确网站故障在用量未知时立即释放",freed.creditCall.state==="released"&&JSON.stringify((await statement(actor)).balance)===JSON.stringify(before.balance));
  await running;
  const late=await model(admin,current.creditCall),final=await json(actor.http,work.path+"?requestId="+requestId);
  check("迟到可靠用量只补网站成本",late.costCny!==null&&late.websiteBorne&&late.status==="failed"&&final.creditCall.state==="released"&&final.creditCall.consumed==="0");
  check("迟到成本不向用户追扣",JSON.stringify((await statement(actor)).balance)===JSON.stringify(before.balance));
 });
 await section("browser-disconnect-does-not-stop-provider",async()=>{
  browser=await chromium.launch({headless:true});
  const context=await browserContext(actor),page=await context.newPage();
  await page.goto(base+"/projects",{timeout:120000});
  for(const entry of ["stage","polish"]) {
   const target=entry==="stage"?await session(work):work,requestId=randomUUID(),content="关闭页面后结果可恢复";
   const plan=await fixture("/control",{mode:"hold"}),before=await statement(actor);
   await page.evaluate(({path,requestId,content})=>{window.billingController=new AbortController();void fetch(path,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify({requestId,content}),signal:window.billingController.signal}).then(r=>r.text()).catch(()=>{});},{path:target.path,requestId,content});
   await poll(()=>fixture("/stats"),s=>s.calls.some(c=>c.providerId===plan.providerId));
   await page.evaluate(()=>window.billingController.abort());
   const result=await poll(()=>entry==="stage"?json(actor.http,target.path):json(actor.http,work.path+"?requestId="+requestId),v=>entry==="stage"?v.messages.some(m=>m.creditCall?.state==="settled"):v.creditCall?.state==="settled",15000);
   const call=entry==="stage"?result.messages.find(m=>m.role==="assistant").creditCall:result.creditCall,row=await model(admin,call);
   check(entry+"浏览器断开未冒充主动停止或故障",row.status==="completed"&&!row.websiteBorne&&call.state==="settled");
   check(entry+"断开后照实扣分只发生一次",total(before.balance)-total((await statement(actor)).balance)===units(row.price.start.peak?"4.032":"2.016"));
  }
  await context.close();
 });
 await section("parallel-holds-and-durable-restart",async()=>{
  const target=await session(work),requestId=randomUUID(),before=await statement(actor);
  await fixture("/control",{mode:"stop-unknown"});
  const chat=actor.http.post(base+target.path,{data:{content:"并行冻结保留",requestId:randomUUID()}});
  await poll(()=>statement(actor),s=>s.pendingCalls.filter(c=>c.state==="reserved").length===1);
  await fixture("/control",{mode:"hold"});
  const polishRunning=actor.http.post(base+work.path,{data:{content:"只释放自身故障",requestId}});
  const two=await poll(()=>statement(actor),s=>s.pendingCalls.filter(c=>c.state==="reserved").length===2);
  const operation=await json(actor.http,work.path+"?requestId="+requestId);
  await markModelProcessingFailure(operation.creditCall.id);
  const freed=await statement(actor),otherCall=two.pendingCalls.find(c=>c.id!==operation.creditCall.id&&c.state==="reserved");
  check("故障只释放自身，其他并行冻结不变",!!otherCall&&freed.pendingCalls.some(c=>c.id===otherCall.id&&c.state==="reserved")&&units(freed.balance.gift.reserved)===units(two.balance.gift.reserved)-units(operation.creditCall.reserved),{otherCall,operation:operation.creditCall,before:two,after:freed});
  await json(actor.http,"/api/iterations/"+work.iteration.id+"/sessions/"+target.id+"/stop",{});
  await chat;await polishRunning;
  const preserved=await statement(actor),count=(await fixture("/stats")).count;
  base=(await lifecycle("restart-credit-app")).base;await login(actor.http,actor.email);await login(admin.http,admin.email);
  const restored=await statement(actor),history=await json(actor.http,target.path);
  check("进程重启保留停止待核对及账本",JSON.stringify(restored.balance)===JSON.stringify(preserved.balance)&&history.messages.find(m=>m.role==="assistant").creditCall.state==="pending");
  const result=await actor.http.post(base+work.path,{data:{content:"只释放自身故障",requestId}});
  check("重启后原失败请求只恢复终态",(await result.json()).creditCall.state==="released"&&(await fixture("/stats")).count===count&&total(before.balance)===total(restored.balance));
  observations.push({preserved:preserved.balance,restored:restored.balance});
 });
 await section("processing-stop-regressions",async()=>{
  // 正式辅助函数运行于独立场景Node，与HTTP应用只共享本轮随机隔离库。
  const messages=[{role:"user",content:"持久停止竞争边界"}],usage={prompt_tokens:1000,prompt_cache_hit_tokens:400,prompt_cache_miss_tokens:600,completion_tokens:100,total_tokens:1100};
  const ids=[];
  function input() {
   const requestKey=randomUUID();
   return {userId:actor.user.id,purpose:"polish",projectId:work.project.id,fileId:work.file.id,awaitProcessing:true,model:"deepseek-flash",maxTokens:1024,timeoutMs:10000,transport:"completion",creditBudget:conversationBudget(messages,1024),creditCall:{requestKey,requestDigest:createHash("sha256").update(requestKey).digest("hex"),messageId:randomUUID(),sessionId:work.file.id,context:{purpose:"polish",projectId:work.project.id,fileId:work.file.id}}};
  }
  function observe(meter) {meter.observe({id:"fixture-helper-"+meter.id,model:"deepseek-flash",usage,choices:[{finish_reason:"stop"}]});}
  async function snapshot(id) {
   const [rows]=await getMysqlPool().execute("SELECT m.status,m.stop_requested_at,c.state,c.consumed FROM model_requests m JOIN conversation_credit_calls c ON c.id=m.id WHERE m.id=?",[id]);
   return rows[0];
  }
  const countBefore=(await fixture("/stats")).count;
  for(const reliable of [true,false]) {
   const params=input(),before=await statement(actor),meter=await startModelRequest(params);ids.push(meter.id);
   if(reliable)observe(meter);
   await meter.finish("completed");
   const processing=await snapshot(meter.id);
   must((reliable?"可靠":"未知")+"用量先进入processing+reserved",processing.status==="processing"&&processing.state==="reserved");
   const stop=await getMysqlPool().getConnection();let completing;
   try {
    await stop.beginTransaction();await lockCreditUsers(stop,[actor.user.id]);
    await requestModelStop(stop,actor.user.id,{requestKey:params.creditCall.requestKey,fileId:work.file.id});
    // stop持账号锁，完成事务只能在持久stop提交后继续；不触发内存取消。
    completing=completeModelProcessing(meter.id).then(()=>null,error=>error);
    await stop.commit();
   }catch(error){await stop.rollback();throw error;}finally{stop.release();}
   const refused=await completing;
   check((reliable?"可靠":"未知")+"用量完成事务拒绝已持久stop",refused?.name==="ModelStoppedError");
   const save=await getMysqlPool().getConnection();let guard;
   try {await save.beginTransaction();await lockCreditUsers(save,[actor.user.id]);try{await assertModelProcessingActive(meter.id,save);}catch(error){guard=error;}await save.rollback();}finally{save.release();}
   check("正文保存前守卫拒绝持久stop："+reliable,guard?.name==="ModelStoppedError");
   await markModelProcessingFailure(meter.id,true);
   const final=await snapshot(meter.id),row=await model(admin,{id:meter.id}),after=await statement(actor),expected=row.price.start.peak?"4.032":"2.016";
   check("processing竞争收敛且无reserved："+reliable,final.status==="stopped"&&final.state===(reliable?"settled":"pending")&&!row.websiteBorne,final);
   check("HTTP费用与竞争终态守恒："+reliable,reliable?total(before.balance)-total(after.balance)===units(expected)&&units(String(final.consumed))===units(expected):total(before.balance)===total(after.balance)&&after.pendingCalls.some(c=>c.id===meter.id&&c.state==="pending"));
   await markModelProcessingFailure(meter.id,true);await settleConversationCredits(meter.id);
   check("竞争重试不重复扣费或释放："+reliable,JSON.stringify((await statement(actor)).balance)===JSON.stringify(after.balance));
  }
  for(const status of ["failed","interrupted"]) {
   const meter=await startModelRequest(input());ids.push(meter.id);await meter.finish(status,"fixture_terminal");
   const before=await statement(actor),error=await completeModelProcessing(meter.id).then(()=>null,error=>error),final=await snapshot(meter.id);
   check("complete拒绝故障终态："+status,!!error&&final.status===status&&final.state==="released"&&JSON.stringify((await statement(actor)).balance)===JSON.stringify(before.balance),final);
  }
  // 只替换场景进程无参Date；固定北京时间11:59:59到12:00:01，正式HTTP进程不受影响。
  const NativeDate=globalThis.Date;let clock=NativeDate.parse("2026-11-03T03:59:59.000Z"),late;
  try {
   globalThis.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[clock]));}};
   late=await startModelRequest(input());ids.push(late.id);await late.finish("failed","fixture_early_error");
   clock=NativeDate.parse("2026-11-03T04:00:01.000Z");observe(late);await late.finish("completed");
  }finally{globalThis.Date=NativeDate;}
  const lateBefore=await statement(actor),row=await model(admin,{id:late.id}),final=await snapshot(late.id);
  check("跨价窗口故障迟到可靠usage保留快照",row.status==="failed"&&row.websiteBorne&&row.usageStatus==="reliable"&&row.usage?.total_tokens===1100&&row.costCny===null&&row.costReason==="price_unconfirmed"&&row.price.start.peak&&!row.price.end.peak,row);
  await late.finish("completed");await settleConversationCredits(late.id);
  check("跨价迟到证据保持免单且重试不追扣",final.state==="released"&&units(String(final.consumed))===0n&&JSON.stringify((await statement(actor)).balance)===JSON.stringify(lateBefore.balance));
  check("辅助函数竞争及跨价反例没有供应商调用",(await fixture("/stats")).count===countBefore);
  // 实际生成器停在yield后return，走finally而不经过catch；供应商仅为本机替身。
  const params=input(),previousMode=process.env.AI_MODE;let iterator,receipt,returned;
  try {
   const fixtureUrl=new URL(process.env.V144_PROVIDER_FIXTURE_URL);
   if(fixtureUrl.protocol!=="http:"||fixtureUrl.hostname!=="127.0.0.1"||new URL(process.env.AI_BASE_URL).href!==fixtureUrl.href||process.env.AI_API_KEY!=="isolated-provider-fixture")throw Error("拒绝非本机隔离供应商");
   // AI_MODE 在模块初始化时固定，使用独立模块实例避免此前 replay 导入缓存。
   process.env.AI_MODE="live";
   const {createAIStream,isLiveAI}=await import("../src/lib/ai.ts?stop-billing-live-fixture");
   if(!isLiveAI())throw Error("独立生成器未进入隔离 live 模式");
   await fixture("/control",{mode:"stop-unknown"});
   const iterable=await createAIStream({...params,messages,onRequest:id=>ids.push(id),onReceipt:value=>receipt=value});iterator=iterable[Symbol.asyncIterator]();
   const first=await iterator.next();must("生成器已yield上游文本",!first.done&&!!first.value.choices[0]?.delta?.content);
   await stopPolishRequest(actor.user.id,params.creditCall.requestKey,work.file.id);
   returned=await iterator.return().then(()=>null,error=>error);
  }finally {if(iterator&&!receipt)await iterator.return().catch(()=>{});if(previousMode===undefined)delete process.env.AI_MODE;else process.env.AI_MODE=previousMode;}
  const returnedRow=await snapshot(receipt.id),returnedModel=await model(admin,{id:receipt.id});
  check("消费方return识别持久stop而非故障免单",returned?.name==="ModelStoppedError"&&receipt.status==="stopped"&&returnedRow.status==="stopped"&&returnedRow.state==="pending"&&!returnedModel.websiteBorne,{receipt,returnedRow});
  const [remaining]=await getMysqlPool().query("SELECT id,status FROM model_requests WHERE id IN (?) AND status IN ('running','processing')",[ids]);
  check("新反例无running或processing遗留",remaining.length===0,remaining);
  observations.push({processingStopRegressions:{ids,lateUsage:row,returnReceipt:receipt,remaining}});
 });
 await section("browser-stop-and-responsive-fees",async()=>{
  browser??=await chromium.launch({headless:true});
  const context=await browserContext(actor),page=await context.newPage();
  await page.setViewportSize({width:1440,height:1000});
  try {
   await openEditor(page,work);
   const input=page.getByLabel("Markdown 正文");
   async function viewport(width) {
    await page.setViewportSize({width,height:width===390?844:1000});
    if(!await input.isVisible())await page.getByRole("button",{name:/^文件与上下文/}).click();
    await input.waitFor({state:"visible"});
   }
   async function feeAtBothWidths(state,fragments,label) {
    for(const width of [1440,390]) {
     await viewport(width);
     const fee=page.locator('.project-file-edit [data-credit-state="'+state+'"]');
     await fee.waitFor({state:"visible",timeout:15000});
     const text=await fee.innerText(),account=await statement(actor);
     check(label+" "+width+"px费用状态与说明",fragments.every(fragment=>text.includes(fragment)),{text,state});
     const available=account.balance.gift.available,reserved=account.balance.gift.reserved;
     const header=page.getByRole("link",{name:"账号积分，查看个人中心"});
     const headerText=await poll(async()=>(await header.innerText()).replace(/\s+/g," "),value=>value.includes("可用 "+available+" 积分")&&value.includes("账号冻结 "+reserved+" 积分"));
     check(label+" "+width+"px账号可用与冻结一致",await header.isVisible()&&headerText.includes("账号冻结 "+reserved+" 积分"),{headerText,balance:account.balance});
     check(label+" "+width+"px费用可见且无横向溢出",await fee.evaluate(element=>{const rect=element.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth;}));
     await page.screenshot({path:join(output,"stop-fees-"+state+"-"+width+".png"),fullPage:true});
    }
   }
   // 两种视口都通过真实按钮发送停止，不在浏览器脚本内直接调用停止接口。
   for(const width of [1440,390]) {
    await viewport(width);await input.fill("浏览器真实停止润色 "+width);
    const before=await statement(actor),plan=await fixture("/control",{mode:"hold"});
    await page.getByRole("button",{name:"AI 润色",exact:true}).click();
    await poll(()=>fixture("/stats"),s=>s.calls.some(c=>c.providerId===plan.providerId));
    const stoppedResponse=page.waitForResponse(r=>r.url()===base+work.path&&r.request().method()==="DELETE");
    await page.getByRole("button",{name:"停止润色",exact:true}).click();
    const response=await stoppedResponse,result=await response.json();
    await page.locator('.project-file-edit [data-credit-state="pending"]').waitFor();
    const persisted=await json(actor.http,work.path+"?requestId="+result.requestId),after=await statement(actor);
    check(width+"px真实按钮停止且持久待核对",response.ok()&&persisted.state==="stopped"&&persisted.creditCall.state==="pending"&&persisted.creditCall.reason==="stopped_usage_unconfirmed",persisted);
    check(width+"px停止无可靠用量不猜扣且原文保留",total(before.balance)===total(after.balance)&&(await input.inputValue())==="浏览器真实停止润色 "+width&&after.pendingCalls.some(c=>c.id===persisted.creditCall.id&&c.state==="pending"));
   }
   await feeAtBothWidths("pending",["本次预留","已停止，待核对，预留暂未释放"],"停止待核对");
   const failureBefore=await statement(actor),failedCount=(await fixture("/stats")).count;
   await input.fill("浏览器请求前供应商错误");await fixture("/control",{mode:"request-error"});
   await page.getByRole("button",{name:"AI 润色",exact:true}).click();
   await page.locator('.project-file-edit [data-credit-state="released"]').waitFor();
   check("浏览器请求前错误免单且余额不变",JSON.stringify((await statement(actor)).balance)===JSON.stringify(failureBefore.balance)&&(await fixture("/stats")).count===failedCount+1);
   await feeAtBothWidths("released",["本次预留","已免单，预留已释放"],"故障免单");
   // 上游与应用完成后丢失响应；抑制自动查询，明确检验用户重试原 key。
   const keys=[],beforeLoss=await statement(actor),countBeforeLoss=(await fixture("/stats")).count;
   let lose=true,suppressQueries=true;
   const routePattern="**"+work.path+"*";
   await page.route(routePattern,async route=>{
    if(route.request().method()==="GET"&&suppressQueries)return route.fulfill({status:200,contentType:"application/json",body:"{}"});
    if(route.request().method()!=="POST")return route.continue();
    keys.push(route.request().postDataJSON().requestId);
    if(!lose)return route.continue();
    lose=false;await route.fetch();return route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({error:"测试：已完成但响应丢失"})});
   });
   await input.fill("结果丢失后沿用请求身份");await fixture("/control",{mode:"normal"});
   await page.getByRole("button",{name:"AI 润色",exact:true}).click();
   await page.getByRole("alert").filter({hasText:"测试：已完成但响应丢失"}).waitFor();
   check("响应丢失保留原请求身份与正文",keys.length===1&&await page.evaluate(({key,requestId})=>JSON.parse(sessionStorage.getItem(key))?.pending?.requestId===requestId,{key:"polish:"+actor.user.id+":"+work.project.id+":"+work.file.id,requestId:keys[0]})&&(await input.inputValue())==="结果丢失后沿用请求身份");
   await page.getByRole("button",{name:"重试原请求",exact:true}).click();
   await page.getByRole("button",{name:"保留原文",exact:true}).waitFor();
   suppressQueries=false;await page.unroute(routePattern);
   const completed=await json(actor.http,work.path+"?requestId="+keys[0]),afterLoss=await statement(actor),row=await model(admin,completed.creditCall),expected=row.price.start.peak?"4.032":"2.016";
   check("响应丢失重试同key只调用和结算一次",keys.length===2&&keys[0]===keys[1]&&(await fixture("/stats")).count===countBeforeLoss+1&&completed.creditCall.state==="settled"&&completed.creditCall.consumed===expected&&total(beforeLoss.balance)-total(afterLoss.balance)===units(expected),{keys,completed});
   await feeAtBothWidths("settled",["本次预留","实际消耗 "+expected+" 积分"],"正常结算");
  }catch(error){await page.screenshot({path:join(output,"stop-fees-ui-failure.png"),fullPage:true}).catch(()=>{});throw error;}
  finally {await context.close();}
 });
} catch(error){check("场景准备失败："+error.message,false);}
finally {await closeMysqlPoolForTests();await browser?.close();check("浏览器无运行时异常",pageErrors.length===0,pageErrors);for(const http of clients)await http.dispose();await writeFile(join(output,"scenario-summary.json"),JSON.stringify({pass,fail,aiMode:"replay",applicationAiMode:"live",fixture:true,live:false,realLlmCostCny:"0",workflows,workflowResults,selectedWorkflow:process.env.V144_STOP_BILLING_WORKFLOW??null,assertions,observations,pageErrors},null,2));console.log("结果: "+pass+" 通过, "+fail+" 失败");}
async function openEditor(page,work) {
 await page.goto(base+"/projects/"+work.project.id+"/iterations/"+work.iteration.id,{timeout:120000});
 await page.getByRole("tab",{name:/项目文件/}).click();
 await page.locator("button.project-tree-name").filter({hasText:work.file.filename.split("/").at(-1)}).click();
 await page.getByRole("button",{name:"编辑正文",exact:true}).click();
 await poll(()=>page.getByRole("button",{name:"AI 润色",exact:true}).isEnabled(),v=>v);
}
process.exit(fail>0?1:0);
