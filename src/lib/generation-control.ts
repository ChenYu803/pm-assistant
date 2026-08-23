/**
 * 同一 Node 进程内的生成取消登记。数据库状态仍是跨请求的事实源；此表只负责
 * 尽快中止仍在运行的上游流，避免用户停止后继续消耗模型输出。
 */
const activeGenerations = new Map<string, AbortController>();

export function registerGeneration(messageId: string): AbortController {
  const controller = new AbortController();
  activeGenerations.set(messageId, controller);
  return controller;
}

export function cancelGeneration(messageId: string): boolean {
  const controller = activeGenerations.get(messageId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function releaseGeneration(
  messageId: string,
  controller: AbortController
): void {
  if (activeGenerations.get(messageId) === controller) {
    activeGenerations.delete(messageId);
  }
}
