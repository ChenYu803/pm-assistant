/** 对话持久化与客户端共同使用的 assistant 状态契约。 */
export const ASSISTANT_MESSAGE_STATUSES = [
  "generating",
  "completed",
  "interrupted",
  "failed",
] as const;

export type AssistantMessageStatus =
  (typeof ASSISTANT_MESSAGE_STATUSES)[number];

export const MESSAGE_REPLACEMENT_KINDS = [
  "regenerate",
  "edit",
  "retry",
] as const;

export type MessageReplacementKind =
  (typeof MESSAGE_REPLACEMENT_KINDS)[number];
