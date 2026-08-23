import type { AgentType } from "@/lib/agent-constants";

export const SCOPE_FREEZE_PROPOSAL_MARKER = "%%%SCOPE_FREEZE_PROPOSAL%%%";

export function supportsScopeFreeze(agentType: AgentType): boolean {
  return agentType === "mvp_prd" || agentType === "prototype";
}

export function freezeFilenameForTab({
  agentType,
  displayName,
}: {
  agentType: AgentType;
  displayName: string;
}): string | null {
  if (agentType === "mvp_prd") return `概念版（${displayName}）.md`;
  if (agentType === "prototype") return "原型.md";
  return null;
}

export function getExpectedFreezeDocument({
  agentType,
  displayName,
  content,
}: {
  agentType: AgentType;
  displayName: string;
  content: string;
}): { filename: string; content: string } | null {
  const filename = freezeFilenameForTab({ agentType, displayName });
  if (!filename) return null;
  const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = new RegExp(
    `%%%FILE_BEGIN%%%\\s*${escapedFilename}\\s*\\n([\\s\\S]*?)%%%FILE_END%%%`
  );
  const match = content.match(marker);
  return match ? { filename, content: match[1].trim() } : null;
}

/** 仅由显式控件请求调用；自然语言不会把这段指令加入模型上下文。 */
export function freezeGenerationInstruction({
  agentType,
  displayName,
}: {
  agentType: AgentType;
  displayName: string;
}): string {
  const filename = freezeFilenameForTab({ agentType, displayName });
  return `\n\n## 显式冻结操作\n\n用户刚刚通过界面控件确认冻结。现在只生成待写入文档，必须用以下完整文件标记输出：\n\n%%%FILE_BEGIN%%% ${filename}\n[完整文档]\n%%%FILE_END%%%\n\n不要输出 %%%SCOPE_FROZEN%%% 或 ${SCOPE_FREEZE_PROPOSAL_MARKER}；正式冻结由文件写入成功后的服务端操作决定。`;
}
