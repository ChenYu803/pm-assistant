import type {
  AssistantMessageStatus,
  MessageReplacementKind,
  MessageRole,
} from "@/models/Message";

type MessageId = { toString(): string } | string;

export interface RecoveryMessage {
  _id: MessageId;
  role: MessageRole;
  status?: AssistantMessageStatus;
  replacement_target_id?: MessageId;
  replacement_commit_message_id?: MessageId;
  superseded_by_message_id?: MessageId;
  replacement_committed?: boolean;
  replacement_kind?: MessageReplacementKind;
}

export function messageIdOf(value: MessageId | undefined): string | undefined {
  return value?.toString();
}

/**
 * 替换操作以候选 assistant 的 replacement_committed 作为可见性提交屏障。
 * 提交前即使旧消息已写入 superseded_by，也继续显示旧历史；因此中途失败不会
 * 造成用户视角的历史丢失或完成态新旧双气泡。
 */
export function getVisibleMessages<T extends RecoveryMessage>(messages: T[]): T[] {
  const committedReplacementIds = new Set(
    messages
      .filter((message) => message.replacement_committed)
      .map((message) => messageIdOf(message._id))
      .filter((id): id is string => Boolean(id))
  );

  return messages.filter((message) => {
    const supersededBy = messageIdOf(message.superseded_by_message_id);
    if (supersededBy && committedReplacementIds.has(supersededBy)) {
      return false;
    }

    const commitMessageId = messageIdOf(message.replacement_commit_message_id);
    if (commitMessageId && !committedReplacementIds.has(commitMessageId)) {
      return false;
    }

    const isUncommittedCompletedReplacement =
      message.role === "assistant" &&
      Boolean(message.replacement_target_id) &&
      message.status === "completed" &&
      !message.replacement_committed;
    return !isUncommittedCompletedReplacement;
  });
}
