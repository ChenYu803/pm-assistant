import { emailNow } from "@/lib/auth-email-test-boundary";

/** 复用已有隔离时钟门禁；生产没有可调整时间的参数或路由。所有核对时间按 UTC 存储。 */
export async function pendingUsageNow() {
  return (await emailNow()).toISOString().slice(0, 23).replace("T", " ");
}
