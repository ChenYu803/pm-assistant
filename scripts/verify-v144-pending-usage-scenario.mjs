// #10：正式应用 HTTP + 独立恢复进程；仅隔离 MySQL 与本机外部替身。
import { request } from "playwright-core";
import { startModelRequest, completeModelProcessing } from "../src/lib/model-metering.ts";
import { conversationBudget } from "../src/lib/conversation-credit-budget.ts";
import { closeMysqlPoolForTests } from "../src/lib/mysql.ts";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { requestRegistrationCode, fixtureRequest } from "./verify-email-fixture.mjs";
let base=process.env.BASE_URL;
const output=process.env.V141_REPLAY_OUTPUT_DIR, clients=[],workflows=[],assertions=[],observations=[];
let pass=0,fail=0;
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
async function lifecycle(type,payload={}){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{process.off("message",listener);reject(Error("隔离生命周期超时"));},60000);const listener=message=>{if(message.type!==type)return;clearTimeout(timer);process.off("message",listener);if(message.error)reject(Error(message.error));else resolve(message);};process.on("message",listener);process.send({type,...payload});});}
async function model(admin,call){const result=await json(admin.http,"/api/admin/model-requests?q="+call.id);return result.requests.find(row=>row.id===call.id);}

async function advance(seconds) { while(seconds>0) { const step=Math.min(seconds,3600); await fixtureRequest("/advance",{seconds:step}); seconds-=step; } }
async function worker(script="scripts/pending-usage-recovery.ts",extra={}) {
 return new Promise((resolveResult,reject)=>{
  const child=spawn(process.execPath,["--import",pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,script],{env:{...process.env,...extra},windowsHide:true,stdio:["ignore","pipe","pipe"]});
  let output=""; for(const stream of [child.stdout,child.stderr])stream.on("data",chunk=>output+=chunk);
  const timer=setTimeout(()=>{child.kill();reject(Error("恢复进程超过60秒"));},60000);
  child.on("error",error=>{clearTimeout(timer);reject(error);});child.on("exit",code=>{clearTimeout(timer);code===0?resolveResult(output):reject(Error("恢复进程失败："+output.slice(-1600)));});
 });
}
try {
 if(!/^v141_replay_[a-f0-9]{16}$/.test(process.env.MYSQL_DATABASE||"")||!process.env.V144_PROVIDER_FIXTURE_URL)throw Error("拒绝非隔离执行");
 const admin=await client(process.env.V144_ADMIN_EMAIL),actor=await client("pending-"+randomUUID()+"@test.local");
 await grant(admin,actor,"10000"); const work=await make(actor);
 // 继承 #09 的计量生命周期公开接口：模拟同一次调用迟到的供应商证据，不添加生产注入路由。
 const usage={prompt_tokens:1000,prompt_cache_hit_tokens:400,prompt_cache_miss_tokens:600,completion_tokens:100,total_tokens:1100};
 async function pendingMeter(complete=true) {
  const requestKey=randomUUID(),messages=[{role:"user",content:"迟到可靠用量"}];
  const meter=await startModelRequest({userId:actor.user.id,purpose:"polish",awaitProcessing:true,projectId:work.project.id,fileId:randomUUID(),model:"deepseek-flash",maxTokens:1024,timeoutMs:10000,transport:"completion",creditBudget:conversationBudget(messages,1024),creditCall:{requestKey,requestDigest:createHash("sha256").update(requestKey).digest("hex"),messageId:randomUUID(),sessionId:randomUUID(),context:{purpose:"polish",projectId:work.project.id}}});
  meter.observe({id:"evidence-"+meter.id,model:"deepseek-flash",choices:[{finish_reason:"stop"}]});await meter.finish("completed");if(complete)await completeModelProcessing(meter.id);return meter;
 }
 function evidence(meter) {meter.observe({id:"evidence-"+meter.id,model:"deepseek-flash",usage,choices:[{finish_reason:"stop"}]});}
 await section("reliable-evidence-before-expiry",async()=>{
  const before=await statement(actor);
  const NativeDate=globalThis.Date;let clock=NativeDate.parse("2026-11-03T03:59:59.000Z"),meter;
  try {globalThis.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[clock]));}};meter=await pendingMeter();}
  finally {globalThis.Date=NativeDate;}
  const original=await model(admin,meter),expected=original.price.start.peak?"4.032":"2.016";
  evidence(meter);
  try {clock=NativeDate.parse("2026-11-03T04:00:01.000Z");globalThis.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[clock]));}};await Promise.all([meter.finish("completed"),meter.finish("completed"),worker()]);}
  finally {globalThis.Date=NativeDate;}
  const after=await statement(actor);
  check("期限内可靠证据自动结算且释放余量",!after.pendingCalls.some(c=>c.id===meter.id)&&after.balance.gift.reserved==="0"&&total(before.balance)-total(after.balance)===units(expected));
  const verified=await model(admin,meter);
  const priceEvidence={originalPrice:original.price,verifiedPrice:verified.price,startedAt:original.startedAt,endedAt:verified.endedAt,evidenceAt:new NativeDate(clock).toISOString(),costCny:verified.costCny,expectedCostCny:"0.002016",expectedConsumed:expected,actualConsumed:text(total(before.balance)-total(after.balance))};
  observations.push({name:"跨时段核对价格证据",...priceEvidence});
  // 后台 DECIMAL(28,8) 保留尾零，按八位定点金额比较，不能依赖字符串格式。
  check("跨时段核对保留原请求适用价格",verified.costCny!==null&&units(verified.costCny)===201600n&&original.price.start.peak&&verified.price.end.peak,priceEvidence);
  check("可靠核对只生成一次扣费",after.entries.filter(e=>e.context?.callId===meter.id&&e.businessType==="model_settle").length===1);
 });
 await section("expiry-evidence-races-and-retry",async()=>{
  const before=await statement(actor),expired=await pendingMeter(),late=await pendingMeter(),free=await pendingMeter(false);
  await free.finish("failed","fixture_failure");
  const faultBefore=await model(admin,free);check("明确故障立即免单且成本仍未知",faultBefore.websiteBorne&&faultBefore.costCny===null&&!(await statement(actor)).pendingCalls.some(c=>c.id===free.id));
  await advance(86401);
  const freshTarget=await session(work);await generate(freshTarget,"missing");
  const fresh=(await history(freshTarget)).messages.find(m=>m.role==="assistant").creditCall;
  const heldBefore=await statement(actor);
  await lifecycle("stop-write-fault",{target:"release"});
  let failed=false;try {await worker();}catch {failed=true;}finally {await lifecycle("stop-clear-fault");}
  check("释放写入失败回滚且保留重试任务",failed&&JSON.stringify((await statement(actor)).balance)===JSON.stringify(heldBefore.balance));
  evidence(expired);
  await Promise.all([worker(),worker(),expired.finish("completed"),expired.finish("completed")]);
  const after=await statement(actor);
  check("到期与可靠证据竞争不再扣分",total(before.balance)===total(after.balance)&&after.pendingCalls.length===1&&after.pendingCalls[0].id===fresh.id);
  check("只释放到期调用不影响新预留",units(after.balance.gift.reserved)===units(fresh.reserved));
  const raceRow=await model(admin,expired);check("到期仍保留已确认网站成本",raceRow.websiteBorne&&raceRow.costCny!==null);
  const beforeLate=await statement(actor);evidence(late);evidence(free);
  await Promise.all([late.finish("completed"),free.finish("completed"),worker()]);
  const afterLate=await statement(actor);
  check("免单后的迟到证据不重新冻结或追扣",JSON.stringify(beforeLate.balance)===JSON.stringify(afterLate.balance)&&beforeLate.total===afterLate.total);
  check("到期与明确故障均可补网站成本",(await model(admin,late)).websiteBorne&&(await model(admin,late)).costCny!==null&&(await model(admin,free)).websiteBorne&&(await model(admin,free)).costCny!==null);
  await advance(86401);await worker();check("新调用按自己的进入时间到期",(await statement(actor)).balance.gift.reserved==="0");
  await fixtureRequest("/clock-reset",{});
 });
 await section("abandoned-process-recovery",async()=>{
  const before=await statement(actor),ids=[];
  for(const phase of ["running","processing"]) {
   const abandoned=JSON.parse(await worker("scripts/verify-v144-abandoned-model.mjs",{V144_ABANDONED_USER_ID:actor.user.id,V144_ABANDONED_PHASE:phase}));ids.push(abandoned.id);
   check("退出前事务已持久预留："+phase,(await statement(actor)).pendingCalls.some(c=>c.id===abandoned.id&&c.state==="reserved"));
  }
  await advance(120);base=(await lifecycle("restart-credit-app")).base;
  await Promise.all([worker(),worker()]);const after=await statement(actor);
  check("发起进程退出后恢复不永久冻结",after.balance.gift.reserved==="0"&&total(before.balance)===total(after.balance)&&!after.pendingCalls.some(c=>ids.includes(c.id)));
  const rows=await Promise.all(ids.map(id=>model(admin,{id})));
  check("中断已知与未知网站成本分开",rows.every(r=>r.status==="interrupted"&&r.websiteBorne)&&rows[0].costCny===null&&rows[1].costCny!==null);
  await fixtureRequest("/clock-reset",{});
 });
 await section("offline-expiry-and-idempotency",async()=>{
  const target=await session(work),generated=await generate(target,"missing");
  const call=(await history(target)).messages.find(row=>row.role==="assistant").creditCall;
  must("真实生成缺用量进入待核对",generated.response.ok()&&call.state==="pending");
  const held=await statement(actor); check("仅冻结该笔额度",units(held.balance.gift.reserved)===units(call.reserved)&&units(held.balance.gift.available)>0n);
  const other=await generate(await session(work),"normal"); check("其他可用积分仍可调用",other.response.ok());
  const before=await statement(actor);
  await worker(); check("期限内无证据保持冻结",(await statement(actor)).pendingCalls.some(row=>row.id===call.id));
  await advance(86401); base=(await lifecycle("restart-credit-app")).base;
  await Promise.all([worker(),worker()]);
  const after=await statement(actor),ended=(await history(target)).messages.find(row=>row.role==="assistant").creditCall;
  check("页面关闭且应用重启后后台到期免单",ended.state==="released"&&ended.consumed==="0"&&ended.reason==="pending_expired");
  check("到期释放全部预留且未扣费",after.balance.gift.reserved==="0"&&total(before.balance)===total(after.balance));
  check("用户待核对结束",!after.pendingCalls.some(row=>row.id===call.id));
  check("后台成本未知与免单分开记录",(await model(admin,call)).websiteBorne&&(await model(admin,call)).costCny===null);
  const entries=after.entries.filter(row=>row.context?.callId===call.id);
  await worker();check("重复并发恢复不重复释放",(await statement(actor)).total===after.total&&entries.filter(row=>row.businessType==="model_release").length===1);
 });
} catch(error) {check("场景准备失败："+error.message,false);}
finally {await closeMysqlPoolForTests();for(const http of clients)await http.dispose();await writeFile(join(output,"scenario-summary.json"),JSON.stringify({pass,fail,aiMode:"replay",fixture:true,live:false,realLlmCostCny:"0",workflows,assertions,observations},null,2));console.log("结果: "+pass+" 通过, "+fail+" 失败");}
process.exit(fail>0?1:0);
