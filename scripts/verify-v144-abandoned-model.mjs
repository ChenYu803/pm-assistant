// #10 专项子进程：只在随机隔离库模拟提交预留后退出，不提供生产接口。
import { randomUUID, createHash } from "node:crypto";
import { emailTestBoundary } from "../src/lib/auth-email-test-boundary.ts";
import { startModelRequest } from "../src/lib/model-metering.ts";
import { conversationBudget } from "../src/lib/conversation-credit-budget.ts";
if (!emailTestBoundary() || !process.env.V144_ABANDONED_USER_ID) throw Error("拒绝非隔离退出夹具");
const requestKey=randomUUID(),messages=[{role:"user",content:"进程退出前已提交预留"}];
const meter=await startModelRequest({userId:process.env.V144_ABANDONED_USER_ID,purpose:"polish",awaitProcessing:true,model:"deepseek-flash",maxTokens:1024,timeoutMs:1000,transport:"completion",creditBudget:conversationBudget(messages,1024),creditCall:{requestKey,requestDigest:createHash("sha256").update(requestKey).digest("hex"),messageId:randomUUID(),sessionId:randomUUID(),context:{purpose:"polish",isolatedAbandoned:true}}});
if (process.env.V144_ABANDONED_PHASE === "processing") {
 meter.observe({id:"abandoned-"+meter.id,model:"deepseek-flash",usage:{prompt_tokens:1000,prompt_cache_hit_tokens:400,prompt_cache_miss_tokens:600,completion_tokens:100,total_tokens:1100},choices:[{finish_reason:"stop"}]});
 await meter.finish("completed");
}
process.stdout.write(JSON.stringify({id:meter.id}));
// 模拟无 finally 清理的进程消失：原事务已提交，内存计量器随进程丢失。
process.exit(0);
