"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { AgentType, FreezeStatus } from "@/lib/agent-constants";
import {
  AGENT_TYPE_ICONS,
  AGENT_TYPE_LABELS,
  AGENT_TYPE_METADATA,
} from "@/lib/agent-constants";
import { SCOPE_FREEZE_PROPOSAL_MARKER } from "@/lib/freeze-protocol";
import FileConfirmDialog, {
  type FileToConfirm,
  type PendingFile,
} from "@/components/FileConfirmDialog";
import TicketSetConfirmDialog from "@/components/TicketSetConfirmDialog";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { isWorkingDocFile, PRODUCT_TICKET_RE } from "@/lib/file-helpers";
import type {
  AssistantMessageStatus,
  MessageReplacementKind,
} from "@/lib/message-types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  status?: AssistantMessageStatus;
  errorMessage?: string;
  replacesMessageId?: string;
  replacementKind?: MessageReplacementKind;
  fileProvenance?: {
    tracked: boolean;
    writes: Array<{
      id: string;
      filename: string;
      operation: "create" | "update";
      fileVersion: number;
      messageStatus: "completed";
      writeStatus: "written";
      writtenAt: string;
    }>;
  };
}

interface ChatAreaProps {
  tabId: string | null;
  workRecordId: string | null;
  tabName: string | null;
  tabVersion: number | null;
  freezeStatus: FreezeStatus | null;
  freezeMessageId?: string;
  freezeError?: string;
  agentType: AgentType | null;
  projectId: string | null;
  /** Filenames already present in the project — used to skip re-confirming completed writes. */
  existingFileNames?: string[];
  /** True once the project file list has loaded. History is only scanned for
   *  file markers after this — otherwise a slow file fetch would make us
   *  re-ask for a write the user already confirmed. */
  filesReady?: boolean;
  onWorkRecordRenamed?: (newName: string) => void;
  onFileSaved?: () => void; // notify parent to refresh file list
  onTabVersionChange?: (tabId: string, version: number) => void;
  onTabConflict?: (tabId: string) => void;
  onTabFreezeStateChange?: (
    tabId: string,
    state: {
      freezeStatus: FreezeStatus;
      scopeFrozen?: boolean;
      freezeMessageId?: string;
      freezeError?: string;
      version?: number;
    }
  ) => void;
}

interface SseEvent {
  type: "start" | "token" | "done" | "error";
  content?: string;
  messageId?: string;
  userMessageId?: string;
  message?: string;
  interrupted?: boolean;
  status?: AssistantMessageStatus;
  timestamp?: string;
  errorMessage?: string;
  replacesMessageId?: string;
  replacementKind?: MessageReplacementKind;
  replacesMessageIds?: string[];
  replaceFromMessageId?: string;
  replacementUserMessage?: ChatMessage;
  tabVersion?: number;
  freezeStatus?: FreezeStatus;
  freezeMessageId?: string;
  freezeError?: string;
}

interface FileConsistencyPrompt {
  message: ChatMessage;
  staleFileNames: string[];
}

function hasWrittenFile(message: ChatMessage, filename: string): boolean {
  return message.fileProvenance?.writes.some(
    (write) => write.filename === filename && write.writeStatus === "written"
  ) ?? false;
}

/**
 * 配置类错误（API key 无效/未配置等）无法通过重试解决，走弹窗提示；
 * 其余错误（网络中断、超时等）保留对话区 banner + 重试。
 */
function isConfigError(message: string): boolean {
  return /401|authentication|api[ _-]?key|AI_API_KEY|invalid_api_key/i.test(
    message
  );
}

const CONTEXT_TOKEN_LIMIT = 32_768;
const CONTEXT_WARNING_TOKENS = 24_000;
const TAB_CONFLICT_MESSAGE = "此标签页正在被其他窗口修改";

/** 使用字符数粗估上下文，不发网络请求；异常时返回 null 以静默隐藏辅助位。 */
function estimateContextTokens(messages: ChatMessage[], input: string): number | null {
  try {
    if (!Array.isArray(messages) || typeof input !== "string") {
      return null;
    }

    const characterCount = messages.reduce((total, message) => {
      if (!message || typeof message.content !== "string") {
        throw new Error("消息内容不可估算");
      }
      return total + message.content.length;
    }, input.length);

    if (!Number.isSafeInteger(characterCount) || characterCount < 0) {
      return null;
    }
    return Math.ceil(characterCount / 4);
  } catch {
    return null;
  }
}

// ─── File marker parsing ─────────────────────────────────────────────────────

const FILE_MARKER_RE =
  /%%%FILE_BEGIN%%%\s*(.+?\.md)\s*\n([\s\S]*?)%%%FILE_END%%%/g;
const HTML_MARKER_RE = /%%%HTML_BEGIN%%%\s*\n?([\s\S]*?)%%%HTML_END%%%/g;

let clientMessageSequence = 0;

function createClientMessageId(prefix: string): string {
  clientMessageSequence += 1;
  return `${prefix}-${Date.now()}-${clientMessageSequence}`;
}

/** Extract all file blocks from content. Returns array of {filename, content}. */
function extractFileMarkers(content: string): FileToConfirm[] {
  const results: FileToConfirm[] = [];
  const regex = new RegExp(FILE_MARKER_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    results.push({ filename: match[1].trim(), content: match[2].trim() });
  }
  return results;
}

function extractHtmlSnapshots(content: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(HTML_MARKER_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const html = match[1].trim();
    if (html) results.push(html);
  }
  return results;
}

/** 将对话中的内部协议标记转换为用户可复制的纯文本。 */
function toCopyText(content: string): string {
  return content
    .replace(/%%%SCOPE_FROZEN%%%/g, "")
    .replace(new RegExp(SCOPE_FREEZE_PROPOSAL_MARKER, "g"), "")
    .replace(
      /%%%FILE_BEGIN%%%\s*.+?\.md\s*\n([\s\S]*?)%%%FILE_END%%%/g,
      "$1"
    )
    .replace(
      /%%%HTML_BEGIN%%%\s*\n?[\s\S]*?%%%HTML_END%%%/g,
      "HTML 原型快照已生成"
    )
    .replace(/%%%[A-Z_]+%%%/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

// ─── SSE line parser ─────────────────────────────────────────────────────────

/**
 * Parse a raw SSE data line into an SseEvent object.
 * Handles the standard format: `data: {"type":"token","content":"..."}`
 */
function parseSseLine(line: string): SseEvent | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6)) as SseEvent;
  } catch {
    return null;
  }
}

// ─── Message bubble component ────────────────────────────────────────────────

function MessageBubble({
  message,
  isStreaming,
  children,
  onCopy,
  onDelete,
  onEdit,
  onRegenerate,
  onRetry,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  children?: ReactNode;
  onCopy?: () => Promise<void>;
  onDelete?: () => void;
  onEdit?: () => void;
  onRegenerate?: () => void;
  onRetry?: () => void;
}) {
  const isUser = message.role === "user";
  const statusLabel =
    message.status === "generating"
      ? "正在生成"
      : message.status === "interrupted"
        ? "已中断"
        : message.status === "failed"
          ? "生成失败"
          : null;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!onCopy) return;
    await onCopy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      data-testid="message-bubble"
      data-message-id={message.id}
      className={`group mb-4 flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`flex max-w-[80%] items-center gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
        {/* Avatar */}
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${
            isUser
              ? "bg-indigo-600 text-white"
              : "bg-gray-200 text-gray-700"
          }`}
        >
          {isUser ? "我" : "AI"}
        </div>

        {/* Bubble */}
        <div
          className={`rounded-lg px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "bg-indigo-600 text-white"
              : "bg-white border border-gray-200 text-gray-900"
          }`}
        >
          <div className="whitespace-pre-wrap break-words">
            {children ?? message.content}
            {isStreaming && (
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-current align-text-bottom" />
            )}
          </div>
          {statusLabel && (
            <div
              className={`mt-2 text-xs ${
                message.status === "failed"
                  ? "text-red-600"
                  : message.status === "interrupted"
                    ? "text-amber-700"
                    : "text-gray-500"
              }`}
            >
              {statusLabel}
              {message.status === "failed" && message.errorMessage
                ? `：${message.errorMessage}`
                : ""}
            </div>
          )}
        </div>

        {!isStreaming && (onCopy || onDelete || onEdit || onRegenerate || onRetry) && (
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {onEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="编辑"
                title="编辑并重新发送这条消息"
                onClick={onEdit}
                className="h-7 px-2 text-xs text-gray-500 hover:text-gray-900"
              >
                编辑
              </Button>
            )}
            {onRegenerate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="重新输出"
                title="重新输出这条 AI 回复"
                onClick={onRegenerate}
                className="h-7 px-2 text-xs text-gray-500 hover:text-gray-900"
              >
                重新输出
              </Button>
            )}
            {onRetry && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="重试"
                title="使用新的请求重试这次生成"
                onClick={onRetry}
                className="h-7 px-2 text-xs text-gray-500 hover:text-gray-900"
              >
                重试
              </Button>
            )}
            {onCopy && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="复制"
                title="复制消息"
                onClick={() => void handleCopy()}
                className="h-7 px-2 text-xs text-gray-500 hover:text-gray-900"
              >
                {copied ? "已复制" : "复制"}
              </Button>
            )}
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="删除"
                title="删除消息"
                onClick={onDelete}
                className="h-7 px-2 text-xs text-gray-500 hover:text-red-600"
              >
                删除
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── File marker banner ──────────────────────────────────────────────────────

function FileMarkerBanner({
  filename,
  written,
  onWrite,
}: {
  filename: string;
  /** True once this message's file has been written — shows status instead of a button. */
  written?: boolean;
  onWrite?: () => void;
}) {
  return (
    <div className="mx-auto mb-4 max-w-[80%] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-amber-800">
        <span className="text-base">📄</span>
        <span>
          Agent 产出文件：<strong>{filename}</strong>
        </span>
      </div>
      {written ? (
        <div className="mt-2 text-xs font-medium text-green-700">✓ 已写入项目文件</div>
      ) : (
        onWrite && (
          <Button
            onClick={onWrite}
            size="sm"
            className="mt-2 bg-amber-100 text-amber-800 hover:bg-amber-200"
          >
            写入项目文件
          </Button>
        )
      )}
    </div>
  );
}

/**
 * HTML 原型快照横幅：Agent 以 %%%HTML_BEGIN%%%/%%%HTML_END%%% 输出的单文件 HTML
 * 在对话流中不渲染源码（保对话形态），只展示下载按钮——Blob 下载后浏览器打开，
 * HTML 只是可视化媒介，不进文件树、不参与交付（spec: Implementation Decisions）。
 */
function HtmlSnapshotBanner({ html }: { html: string }) {
  const [downloaded, setDownloaded] = useState(false);
  const handleDownload = () => {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // 固定文件名——多份快照同名下载时浏览器自动编号（(1)(2)…），
    // 避免跨消息序号重置导致重名覆盖
    a.download = "原型快照.html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };
  return (
    <div className="mx-auto mb-4 max-w-[80%] rounded-lg border border-sky-200 bg-sky-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-sky-800">
        <span className="text-base">🖼️</span>
        <span>
          HTML 原型快照已生成（<strong>下载后浏览器打开</strong>）
        </span>
      </div>
      <Button
        onClick={handleDownload}
        size="sm"
        className="mt-2 bg-sky-100 text-sky-800 hover:bg-sky-200"
      >
        {downloaded ? "✓ 已下载" : "下载 HTML 原型"}
      </Button>
    </div>
  );
}

/**
 * 流式期间 HTML 原型快照的占位提示：HTML 源码动辄 5-15K tokens，逐 token
 * 流式渲染进对话框既拖慢滚动又让用户看不懂——流式中只显示「正在输出」状态；
 * 回复完成存库后由 renderContentWithMarkers 替换为 HtmlSnapshotBanner 下载按钮。
 */
function StreamingHtmlPlaceholder() {
  return (
    <div className="flex items-center gap-2 text-sm text-sky-600">
      <span className="animate-pulse">📄 正在输出HTML原型文件...</span>
    </div>
  );
}

// ─── ChatArea ────────────────────────────────────────────────────────────────

export default function ChatArea({
  tabId,
  workRecordId,
  tabName,
  tabVersion,
  freezeStatus,
  freezeMessageId,
  freezeError,
  agentType,
  projectId,
  existingFileNames,
  filesReady = true,
  onWorkRecordRenamed,
  onFileSaved,
  onTabVersionChange,
  onTabConflict,
  onTabFreezeStateChange,
}: ChatAreaProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeAssistantMessageId, setActiveAssistantMessageId] =
    useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState("");
  // 配置类错误（API key 无效/未配置）——弹窗提示，不进对话区，也不提供重试
  const [configError, setConfigError] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const autoScrollPendingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const freezeTransitionRef = useRef(false);
  // SSE 与历史对账已取得的冻结事实可先于父级 tab state 重新渲染到达。
  // 文件确认必须读取最新持久化状态，不能被旧闭包阻塞在 awaiting_write 之外。
  const freezeStatusRef = useRef(freezeStatus);
  const freezeMessageIdRef = useRef(freezeMessageId);
  // Last sent content — state, not a ref: it's read during render (retry button)
  const [lastSentContent, setLastSentContent] = useState("");
  const [pendingDeleteMessage, setPendingDeleteMessage] =
    useState<ChatMessage | null>(null);
  const [deletingMessage, setDeletingMessage] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const editDraftRef = useRef("");
  const contextUsage = useMemo(
    () => estimateContextTokens(messages, input),
    [messages, input]
  );
  const contextNeedsWarning =
    contextUsage !== null && contextUsage >= CONTEXT_WARNING_TOKENS;

  // File confirmation state
  // Agent 一次输出的多个文件在同一个弹窗中统一勾选处理。
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [showFileDialog, setShowFileDialog] = useState(false);
  const [pendingTicketSet, setPendingTicketSet] = useState<PendingFile[]>([]);
  const [showTicketSetDialog, setShowTicketSetDialog] = useState(false);
  const [fileConsistencyPrompt, setFileConsistencyPrompt] =
    useState<FileConsistencyPrompt | null>(null);
  const [savingFile, setSavingFile] = useState(false);
  // Track processed message IDs to avoid re-showing dialogs
  const processedFileMessageIds = useRef<Set<string>>(new Set());
  // 本会话内实时产生（SSE done 事件）的 assistant 消息 id。历史重放扫描 effect
  // 在 done 处理器的 setTimeout(100) 之前（effect 内 setTimeout(0)）就会跑，
  // 若扫描把实时消息也当历史处理，「文件名已存在 → 跳过」的兜底会吞掉新消息
  // 的写入判定——实时消息必须走「消息是否已写入」判定，不做文件名兜底
  // （v1.1 文件更新修复）。id 全局唯一（ObjectId），切 tab 后无需清理。
  const liveMessageIds = useRef<Set<string>>(new Set());
  const pendingFileSequence = useRef(0);

  /** 聊天完成后单独请求命名；失败保持静默，不能反过来影响已完成的聊天。 */
  const requestAutomaticName = useCallback(
    async (completedTabId: string) => {
      if (!workRecordId) return;

      try {
        const res = await fetch(`/api/work-records/${workRecordId}/auto-name`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tabId: completedTabId }),
        });
        if (!res.ok) return;

        const data = await res.json().catch(() => ({}));
        if (typeof data.name === "string" && data.name) {
          onWorkRecordRenamed?.(data.name);
        }
      } catch {
        // 自动命名是辅助结果；网络或命名服务失败时用户仍可继续聊天和手动改名。
      }
    },
    [onWorkRecordRenamed, workRecordId]
  );

  useEffect(() => {
    freezeStatusRef.current = freezeStatus;
    freezeMessageIdRef.current = freezeMessageId;
  }, [freezeMessageId, freezeStatus]);

  // ── File marker parsing (extractFileMarkers lives at module level) ────────

  /** 写文件到项目文件树。返回是否成功；成功时标记来源消息为「已写入」。
   *  工作文档静默写入与正式文件确认后写入共用此函数。
   *  必须 useCallback 且定义在 checkAndShowFileDialog 之前：它出现在后者的
   *  依赖数组里（依赖数组求值时 const 尚未初始化会 ReferenceError）；且缓存
   *  闭包若捕获旧渲染的 projectId/agentType（首次渲染可能为 null），静默写入
   *  会静默失败——useCallback 依赖 [projectId, agentType, onFileSaved] 保证
   *  这些值变化时重建。 */
  const writeFileToServer = useCallback(
    async (
      file: FileToConfirm,
      sourceMessageId: string
    ): Promise<boolean> => {
      if (!projectId || !agentType) return false;
      setSavingFile(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.filename,
            content: file.content,
            agent_type: agentType,
            source_message_id: sourceMessageId,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "保存文件失败");
        }
        const data = await res.json();
        // 只接受服务端成功持久化的来源事实；前端不再把同名文件自行猜成已写入。
        if (data.messageFileWrite) {
          setMessages((previous) =>
            previous.map((message) =>
              message.id !== sourceMessageId
                ? message
                : {
                    ...message,
                    fileProvenance: {
                      tracked: message.fileProvenance?.tracked ?? false,
                      writes: [
                        ...(message.fileProvenance?.writes ?? []),
                        data.messageFileWrite,
                      ],
                    },
                  }
            )
          );
        }
        onFileSaved?.();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存文件失败");
        return false;
      } finally {
        setSavingFile(false);
      }
    },
    [projectId, agentType, onFileSaved]
  );

  const deliverTicketSet = useCallback(
    async (mode: "replace" | "save") => {
      if (!projectId || !agentType || pendingTicketSet.length === 0) return;
      const sourceMessageId = pendingTicketSet[0].messageId;
      if (!sourceMessageId) {
        setError("ticket 候选集合缺少来源消息，无法交付");
        return;
      }
      setSavingFile(true);
      try {
        const response = await fetch(`/api/projects/${projectId}/ticket-sets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            source_message_id: sourceMessageId,
            candidates: pendingTicketSet.map(({ filename, content }) => ({ filename, content })),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "交付 tickets 失败");
        if (Array.isArray(data.writes)) {
          setMessages((previous) =>
            previous.map((message) =>
              message.id !== sourceMessageId
                ? message
                : {
                    ...message,
                    fileProvenance: {
                      tracked: message.fileProvenance?.tracked ?? true,
                      writes: [
                        ...(message.fileProvenance?.writes ?? []),
                        ...data.writes,
                      ],
                    },
                  }
            )
          );
        }
        setPendingTicketSet([]);
        setShowTicketSetDialog(false);
        onFileSaved?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "交付 tickets 失败");
      } finally {
        setSavingFile(false);
      }
    },
    [agentType, onFileSaved, pendingTicketSet, projectId]
  );

  /** Persist completed HTML prototypes as project-scoped snapshots. */
  const saveHtmlSnapshots = useCallback(
    async (content: string) => {
      if (!projectId || !tabId || agentType !== "prototype") return;
      const snapshots = extractHtmlSnapshots(content);
      for (const snapshot of snapshots) {
        try {
          const res = await fetch(`/api/projects/${projectId}/snapshots`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: snapshot, tab_id: tabId }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data.error || "保存 HTML 快照失败");
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "保存 HTML 快照失败");
        }
      }
    },
    [agentType, projectId, tabId]
  );

  /**
   * Check a message for file markers and trigger confirmation dialog.
   * historyReplay = true：只有缺少来源协议标记的历史消息可以按文件名兜底；新消息
   * 只认服务端返回的消息级来源事实，避免同名文件污染。
   * 实时新消息（SSE done）不传此参数：正式文件总是重新触发写入判定——即使同名
   * 文件已存在，也再弹确认框，确认后按既有语义更新（需求分析 append / 其他
   * replace，服务端 files/route.ts），修复「已写入文件无法更新」bug（spec 文件
   * 更新修复）。拒绝仍不落盘；工作文档静默写入路径不受影响。
   */
  const checkAndShowFileDialog = useCallback(
    (message: ChatMessage, historyReplay = false) => {
      if (processedFileMessageIds.current.has(message.id)) return;
      const markers = extractFileMarkers(message.content);
      if (markers.length > 0) {
        processedFileMessageIds.current.add(message.id);
        const ticketMarkers = markers.filter((marker) => PRODUCT_TICKET_RE.test(marker.filename));
        if (
          agentType === "ticket_splitter" &&
          (!historyReplay || message.fileProvenance?.tracked === true) &&
          ticketMarkers.length === markers.length
        ) {
          setPendingTicketSet(
            ticketMarkers.map((marker, index) => ({
              ...marker,
              id: `${message.id}-ticket-${index}-${pendingFileSequence.current++}`,
              messageId: message.id,
            }))
          );
          setShowTicketSetDialog(true);
          return;
        }
        // 同一回复可能同时带工作文档与正式文件 marker（如推进时既更新工作文档
        // 又输出需求分析.md）：工作文档静默写入，正式文件入队逐个弹确认框
        // （02: 任务拆分 Agent 一次输出多个 issue 文件，在同一弹窗中批量处理）。
        const pending: PendingFile[] = [];
        markers.forEach((m, index) => {
          const exactWrite = hasWrittenFile(message, m.filename);
          const mayUseLegacyFilenameFallback =
            historyReplay && message.fileProvenance?.tracked !== true;
          const isPendingFreezeDocument =
            historyReplay &&
            freezeStatusRef.current === "awaiting_write" &&
            freezeMessageIdRef.current === message.id;
          const shouldSkipHistoryWrite =
            exactWrite ||
            (mayUseLegacyFilenameFallback &&
              existingFileNames?.includes(m.filename) &&
              !isPendingFreezeDocument);
          if (isWorkingDocFile(m.filename)) {
            if (shouldSkipHistoryWrite) return;
            void writeFileToServer(m, message.id);
            return;
          }
          if (shouldSkipHistoryWrite) {
            return;
          }
          pending.push({
            ...m,
            id: `${message.id}-${index}-${pendingFileSequence.current++}`,
            messageId: message.id,
          });
        });
        if (pending.length > 0) {
          setPendingFiles((prev) => [...prev, ...pending]);
          setShowFileDialog(true);
        }
      }
    },
    [agentType, existingFileNames, writeFileToServer]
  );

  // ── Fetch message history on tab change ──────────────────────────────────

  useEffect(() => {
    if (!tabId) {
      const reset = window.setTimeout(() => setMessages([]), 0);
      return () => window.clearTimeout(reset);
    }
    const currentTabId = tabId;

    let cancelled = false;
    let recoveryPoll: number | undefined;

    async function fetchMessages(isInitialLoad: boolean) {
      if (isInitialLoad) setLoadingHistory(true);
      setError("");
      try {
        const res = await fetch(`/api/tabs/${currentTabId}/messages`);
        if (!res.ok) throw new Error("获取消息记录失败");
        const data = await res.json();
        if (!cancelled) {
          setMessages(data.messages);
          // 刷新或重连可能发生在服务端完成流式操作之前。消息接口返回的
          // tabVersion 是下一次变更的并发前提，必须与消息事实一起对账。
          if (typeof data.tabVersion === "number") {
            onTabVersionChange?.(currentTabId, data.tabVersion);
          }
          if (data.freezeStatus) {
            freezeStatusRef.current = data.freezeStatus;
            freezeMessageIdRef.current = data.freezeMessageId;
            onTabFreezeStateChange?.(currentTabId, {
              freezeStatus: data.freezeStatus,
              scopeFrozen: data.scopeFrozen === true,
              freezeMessageId: data.freezeMessageId,
              freezeError: data.freezeError,
              version: data.tabVersion,
            });
          }
          if (
            data.messages.some(
              (message: ChatMessage) =>
                message.role === "assistant" && message.status === "generating"
            )
          ) {
            // 刷新/重连期间没有本地 SSE 阅读器时，继续以服务端事实源对账。
            recoveryPoll = window.setTimeout(() => {
              void fetchMessages(false);
            }, 500);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "获取消息记录失败");
        }
      } finally {
        if (!cancelled && isInitialLoad) setLoadingHistory(false);
      }
    }

    void fetchMessages(true);
    return () => {
      cancelled = true;
      if (recoveryPoll) window.clearTimeout(recoveryPoll);
      // Abort any in-progress stream when switching tabs
      abortRef.current?.abort();
      setIsStreaming(false);
      setActiveAssistantMessageId(null);
      setIsStopping(false);
    };
  // tabVersion 会随当前 SSE 的开始与完成事件推进；把它作为依赖会在流仍在
  // 读取时执行 cleanup 并错误 abort 请求。只有切换标签页才应取消当前流。
  }, [tabId]);

  // ── Smart auto-scroll ────────────────────────────────────────────────────

  const handleMessageScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (autoScrollPendingRef.current) return;
    shouldAutoScrollRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight <= 96;
  }, []);

  const markUserScrollIntent = useCallback(() => {
    autoScrollPendingRef.current = false;
  }, []);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) {
      return;
    }
    autoScrollPendingRef.current = true;
    const frame = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
        shouldAutoScrollRef.current = true;
      }
      autoScrollPendingRef.current = false;
    });
    return () => {
      cancelAnimationFrame(frame);
      autoScrollPendingRef.current = false;
    };
  }, [messages]);

  // ── Scan history for file markers (tab re-open) ─────────────────────────
  // Waits for the project file list to finish loading (filesReady): otherwise
  // a slow file fetch would race the message history and re-ask for a write
  // the user already confirmed (the file simply isn't in existingFileNames yet).
  // 历史重放语义（historyReplay=true，文件名兜底）；实时消息（liveMessageIds）
  // 跳过——由 done 事件处理器用「消息级已写入」判定处理（v1.1 文件更新修复，
  // 否则 effect 的 setTimeout(0) 抢在 done 的 setTimeout(100) 前，文件名兜底
  // 会吞掉新消息的写入判定）。
  useEffect(() => {
    if (!tabId || !filesReady || loadingHistory) return;
    // setTimeout 延迟到宏任务：effect 内同步 setState 会触发级联渲染（lint 规则），
    // 弹窗推迟一帧对用户无感知；与 done 事件的 setTimeout 先例一致。
    const t = setTimeout(() => {
      for (const msg of messages) {
        if (
          msg.role === "assistant" &&
          !liveMessageIds.current.has(msg.id)
        ) {
          checkAndShowFileDialog(msg, true);
        }
      }
    }, 0);
    return () => clearTimeout(t);
  }, [tabId, filesReady, loadingHistory, messages, checkAndShowFileDialog]);

  // ── File confirmation handlers ────────────────────────────────────────────

  async function submitFreezeWrite(action: "cancel" | "complete") {
    if (!tabId || tabVersion === null || freezeTransitionRef.current) {
      return false;
    }
    freezeTransitionRef.current = true;
    try {
      const res = await fetch(`/api/tabs/${tabId}/freeze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          expectedVersion: tabVersion,
          requestId: createClientMessageId(`freeze-${action}`),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (typeof data.tabVersion === "number") {
        onTabVersionChange?.(tabId, data.tabVersion);
      }
      if (typeof data.freezeStatus === "string") {
        freezeStatusRef.current = data.freezeStatus;
        freezeMessageIdRef.current = data.freezeMessageId;
        onTabFreezeStateChange?.(tabId, {
          freezeStatus: data.freezeStatus,
          scopeFrozen: data.scopeFrozen === true,
          freezeMessageId: data.freezeMessageId,
          freezeError: data.freezeError,
          version: data.tabVersion,
        });
      }
      if (!res.ok) {
        throw new Error(data.error || "冻结状态更新失败");
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "冻结状态更新失败");
      return false;
    } finally {
      freezeTransitionRef.current = false;
    }
  }

  async function handleConfirmFiles(files: PendingFile[]) {
    if (!projectId || !agentType) return;
    const failed: PendingFile[] = [];
    for (const pending of files) {
      if (
        !pending.messageId ||
        !(await writeFileToServer(pending, pending.messageId))
      ) {
        if (!pending.messageId) setError("文件缺少来源消息，无法写入");
        failed.push(pending);
      }
    }
    // 冻结中的历史确认框可能同时包含同名旧消息的文件；是否应完成冻结
    // 由持久化状态机决定，而非要求前端来源消息 ID 恰好等于当前冻结消息。
    // 服务端仍会按冻结文件名和正文摘要拒绝任何不属于本轮的内容。
    const confirmsPendingFreezeWrite =
      freezeStatusRef.current === "awaiting_write" && files.length > 0;
    let completedFreezeWrite = true;
    if (confirmsPendingFreezeWrite && failed.length === 0) {
      completedFreezeWrite = await submitFreezeWrite("complete");
    }
    if (!completedFreezeWrite) {
      // 冻结完成返回 409（例如摘要不匹配）时，文件已写入但仍未正式冻结。
      // 保留本轮文件让用户写回正确正文后重试，不能让历史扫描的同名文件兜底吞掉确认框。
      failed.push(...files);
    }
    setPendingFiles(failed);
    setShowFileDialog(failed.length > 0);
  }

  function handleCancelFiles() {
    // 未勾选或主动丢弃的文件不请求写入 API，保留「拒绝不落盘」语义。
    setPendingFiles([]);
    setShowFileDialog(false);
    if (freezeStatusRef.current === "awaiting_write") {
      void submitFreezeWrite("cancel");
    }
  }

  function handleCancelTicketSet() {
    setPendingTicketSet([]);
    setShowTicketSetDialog(false);
  }

  function handleKeepFileConsistency() {
    if (!fileConsistencyPrompt) return;
    // 将新消息标记为本会话已处理，选择「保持不变」后不再弹出第二个普通文件弹窗。
    processedFileMessageIds.current.add(fileConsistencyPrompt.message.id);
    setFileConsistencyPrompt(null);
  }

  function handleUpdateFileConsistency() {
    if (!fileConsistencyPrompt) return;
    const message = fileConsistencyPrompt.message;
    setFileConsistencyPrompt(null);
    // 先关闭一致性弹窗，再进入新回复 marker 对应的既有文件确认流程。
    window.setTimeout(() => checkAndShowFileDialog(message), 0);
  }

  // ── Core send logic (shared by sendMessage and retry) ───────────────────

  async function sendContent(
    content: string,
    options?: {
      regenerateMessageId?: string;
      regenerateWrittenFileNames?: string[];
      editMessageId?: string;
      retryMessageId?: string;
      freeze?: boolean;
    }
  ) {
    if (!tabId || tabVersion === null || isStreaming) return;

    setError("");
    const regenerateMessageId = options?.regenerateMessageId;
    const editMessageId = options?.editMessageId;
    const retryMessageId = options?.retryMessageId;
    const isFreeze = options?.freeze === true;
    const createsOptimisticUser =
      !regenerateMessageId && !editMessageId && !retryMessageId && !isFreeze;
    const lastVisibleMessage = messages[messages.length - 1];
    const reusesLastUser =
      createsOptimisticUser &&
      lastVisibleMessage?.role === "user" &&
      lastVisibleMessage.content === content;
    const optimisticUserId = createsOptimisticUser
      ? reusesLastUser
        ? lastVisibleMessage.id
        : createClientMessageId("temp")
      : null;
    if (createsOptimisticUser && !reusesLastUser) {
      const optimisticUser: ChatMessage = {
        id: optimisticUserId!,
        role: "user",
        content,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticUser]);
    }

    setIsStreaming(true);
    setActiveAssistantMessageId(null);
    setIsStopping(false);

    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = createClientMessageId("request");
    const payload = retryMessageId
      ? { retryMessageId, requestId }
      : editMessageId
        ? { content, editMessageId, requestId }
        : regenerateMessageId
          ? { regenerate: true, messageId: regenerateMessageId, requestId }
          : isFreeze
            ? { freeze: true, requestId }
            : { content, requestId };
    const mutationPayload = { ...payload, expectedVersion: tabVersion };

    try {
      const res = await fetch(`/api/tabs/${tabId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutationPayload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || "发送消息失败";
        // 配置类错误直接弹窗，不写入对话区
        if (isConfigError(errMsg)) {
          setConfigError(errMsg);
          return;
        }
        throw new Error(errMsg);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const event = parseSseLine(part.trim());
          if (!event) continue;

          switch (event.type) {
            case "token":
              if (event.content && event.messageId) {
                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === event.messageId
                      ? {
                          ...message,
                          content: message.content + event.content!,
                          status: "generating",
                        }
                      : message
                  )
                );
              }
              break;
            case "start": {
              if (!event.messageId) break;
              if (typeof event.tabVersion === "number") {
                onTabVersionChange?.(tabId, event.tabVersion);
              }
              if (event.freezeStatus) {
                freezeStatusRef.current = event.freezeStatus;
                freezeMessageIdRef.current = event.freezeMessageId;
                onTabFreezeStateChange?.(tabId, {
                  freezeStatus: event.freezeStatus,
                  freezeMessageId: event.freezeMessageId,
                  freezeError: event.freezeError,
                  version: event.tabVersion,
                });
              }
              const newMessage: ChatMessage = {
                id: event.messageId,
                role: "assistant",
                content: "",
                timestamp: event.timestamp || new Date().toISOString(),
                status: "generating",
                replacesMessageId: event.replacesMessageId,
                replacementKind: event.replacementKind,
                fileProvenance: { tracked: true, writes: [] },
              };
              // 在 token 到达前声明实时来源，避免历史扫描把流中的 marker 提前消费。
              liveMessageIds.current.add(event.messageId);
              setActiveAssistantMessageId(event.messageId);
              setMessages((prev) => {
                const next =
                  event.userMessageId && optimisticUserId
                    ? prev.map((message) =>
                        message.id === optimisticUserId
                          ? { ...message, id: event.userMessageId! }
                          : message
                      )
                    : prev;
                return next.some((message) => message.id === event.messageId)
                  ? next
                  : [...next, newMessage];
              });
              break;
            }
            case "done": {
              if (!event.messageId) break;
              if (typeof event.tabVersion === "number") {
                onTabVersionChange?.(tabId, event.tabVersion);
              }
              if (event.freezeStatus) {
                freezeStatusRef.current = event.freezeStatus;
                freezeMessageIdRef.current = event.freezeMessageId;
                onTabFreezeStateChange?.(tabId, {
                  freezeStatus: event.freezeStatus,
                  freezeMessageId: event.freezeMessageId,
                  freezeError: event.freezeError,
                  version: event.tabVersion,
                });
              }
              const completedContent = event.content ?? "";
              const completedMessage: ChatMessage = {
                id: event.messageId,
                role: "assistant",
                content: completedContent,
                timestamp: event.timestamp ?? new Date().toISOString(),
                status: event.status ?? "completed",
                replacesMessageId: event.replacesMessageId,
                replacementKind: event.replacementKind,
                fileProvenance: { tracked: true, writes: [] },
              };
              setMessages((prev) => {
                const currentCandidate = prev.find(
                  (message) => message.id === event.messageId
                );
                const finalCandidate: ChatMessage = {
                  ...currentCandidate,
                  ...completedMessage,
                  replacesMessageId:
                    event.replacesMessageId ?? currentCandidate?.replacesMessageId,
                  replacementKind:
                    event.replacementKind ?? currentCandidate?.replacementKind,
                  errorMessage: undefined,
                };
                if (
                  !event.replacesMessageIds?.length ||
                  !event.replaceFromMessageId
                ) {
                  return prev.map((message) =>
                    message.id === event.messageId ? finalCandidate : message
                  );
                }
                const insertionIndex = prev.findIndex(
                  (message) => message.id === event.replaceFromMessageId
                );
                if (insertionIndex === -1) {
                  return prev.map((message) =>
                    message.id === event.messageId ? finalCandidate : message
                  );
                }
                const removedIds = new Set([
                  ...event.replacesMessageIds,
                  event.messageId,
                ]);
                const remainingBefore = prev
                  .slice(0, insertionIndex)
                  .filter((message) => !removedIds.has(message.id));
                const remainingAfter = prev
                  .slice(insertionIndex + 1)
                  .filter((message) => !removedIds.has(message.id));
                return [
                  ...remainingBefore,
                  ...(event.replacementUserMessage
                    ? [event.replacementUserMessage]
                    : []),
                  finalCandidate,
                  ...remainingAfter,
                ];
              });
              liveMessageIds.current.add(event.messageId);
              void saveHtmlSnapshots(completedContent);
              const newFileNames = new Set(
                extractFileMarkers(completedContent).map((file) => file.filename)
              );
              const staleFileNames = (
                options?.regenerateWrittenFileNames ?? []
              ).filter((filename) => !newFileNames.has(filename));
              if (staleFileNames.length > 0) {
                setFileConsistencyPrompt({
                  message: completedMessage,
                  staleFileNames,
                });
              } else {
                setTimeout(() => checkAndShowFileDialog(completedMessage), 100);
              }
              void requestAutomaticName(tabId);
              break;
            }
            case "error": {
              const errMsg = event.message || "请求发生错误";
              if (typeof event.tabVersion === "number") {
                onTabVersionChange?.(tabId, event.tabVersion);
              }
              if (event.freezeStatus) {
                freezeStatusRef.current = event.freezeStatus;
                freezeMessageIdRef.current = event.freezeMessageId;
                onTabFreezeStateChange?.(tabId, {
                  freezeStatus: event.freezeStatus,
                  freezeMessageId: event.freezeMessageId,
                  freezeError: event.freezeError,
                  version: event.tabVersion,
                });
              }
              if (isConfigError(errMsg)) {
                setConfigError(errMsg);
              } else {
                setError(errMsg);
              }
              if (event.userMessageId && optimisticUserId) {
                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === optimisticUserId
                      ? { ...message, id: event.userMessageId! }
                      : message
                  )
                );
              }
              if (event.messageId) {
                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === event.messageId
                      ? {
                          ...message,
                          content: event.content ?? "",
                          timestamp: event.timestamp ?? message.timestamp,
                          status: event.status ?? (event.interrupted ? "interrupted" : "failed"),
                          errorMessage: event.errorMessage,
                          replacesMessageId:
                            event.replacesMessageId ?? message.replacesMessageId,
                          replacementKind:
                            event.replacementKind ?? message.replacementKind,
                        }
                      : message
                  )
                );
              }
              break;
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "发送消息失败");
    } finally {
      setIsStreaming(false);
      setActiveAssistantMessageId(null);
      setIsStopping(false);
      abortRef.current = null;
    }
  }

  async function beginScopeFreeze() {
    if (
      freezeTransitionRef.current ||
      !["proposed", "failed"].includes(freezeStatus ?? "idle")
    ) {
      return;
    }
    freezeTransitionRef.current = true;
    try {
      await sendContent("", { freeze: true });
    } finally {
      freezeTransitionRef.current = false;
    }
  }

  async function stopGeneration() {
    if (
      !isStreaming ||
      !tabId ||
      tabVersion === null ||
      !activeAssistantMessageId ||
      isStopping
    ) {
      return;
    }
    setIsStopping(true);
    try {
      const res = await fetch(
        `/api/tabs/${tabId}/messages?messageId=${encodeURIComponent(activeAssistantMessageId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId: activeAssistantMessageId,
            expectedVersion: tabVersion,
            requestId: createClientMessageId("stop"),
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "停止生成失败");
      }
      const { message, tabVersion: nextTabVersion } = await res.json();
      if (typeof nextTabVersion === "number") {
        onTabVersionChange?.(tabId, nextTabVersion);
      }
      setMessages((prev) =>
        prev.map((item) =>
          item.id === activeAssistantMessageId
            ? {
                ...item,
                content: message.content,
                timestamp: message.timestamp,
                status: message.status,
                errorMessage: message.errorMessage,
              }
            : item
        )
      );
    } catch (err) {
      setIsStopping(false);
      setError(err instanceof Error ? err.message : "停止生成失败");
    }
  }

  async function copyMessage(content: string) {
    const text = toCopyText(content);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const copyArea = document.createElement("textarea");
      copyArea.value = text;
      copyArea.setAttribute("readonly", "true");
      copyArea.style.position = "fixed";
      copyArea.style.opacity = "0";
      document.body.appendChild(copyArea);
      copyArea.select();
      document.execCommand("copy");
      copyArea.remove();
    } catch {
      setError("复制消息失败，请稍后重试");
    }
  }

  async function confirmDeleteMessage() {
    if (!pendingDeleteMessage || deletingMessage || tabVersion === null) return;
    const message = pendingDeleteMessage;
    if (message.id.startsWith("temp-") || message.id.startsWith("interrupted-")) {
      setMessages((prev) => prev.filter((item) => item.id !== message.id));
      setPendingDeleteMessage(null);
      return;
    }

    setDeletingMessage(true);
    try {
      const res = await fetch(
        `/api/tabs/${tabId}/messages?messageId=${encodeURIComponent(message.id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId: message.id,
            expectedVersion: tabVersion,
            requestId: createClientMessageId("delete"),
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "删除消息失败");
      }
      const result = await res.json();
      if (typeof result.tabVersion === "number") {
        onTabVersionChange?.(tabId!, result.tabVersion);
      }
      setMessages((prev) => prev.filter((item) => item.id !== message.id));
      setPendingDeleteMessage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除消息失败");
    } finally {
      setDeletingMessage(false);
    }
  }

  function beginEditMessage(message: ChatMessage) {
    if (message.role !== "user" || isStreaming) return;
    editDraftRef.current = input;
    setEditingMessage(message);
    setInput(message.content);
    setError("");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function cancelEditMessage() {
    if (!editingMessage) return;
    setInput(editDraftRef.current);
    setEditingMessage(null);
    editDraftRef.current = "";
  }

  async function editAndResendMessage() {
    const editedContent = input.trim();
    const targetMessage = editingMessage;
    if (!editedContent || !targetMessage || !tabId || isStreaming) return;

    setError("");
    try {
      // 编辑重发在服务端独立生成；成功提交前保留当前消息和之后的历史。
      setEditingMessage(null);
      editDraftRef.current = "";
      setInput("");
      setLastSentContent(editedContent);
      await sendContent(editedContent, { editMessageId: targetMessage.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "编辑消息失败");
    }
  }

  // ── Send message ─────────────────────────────────────────────────────────

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || !tabId || isStreaming) return;

    if (editingMessage) {
      await editAndResendMessage();
      return;
    }

    setInput("");
    setLastSentContent(trimmed);
    await sendContent(trimmed);
  }

  // ── Retry handler ────────────────────────────────────────────────────────

  function handleRetry() {
    const lastRecoverableMessage = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          (message.status === "failed" || message.status === "interrupted")
      );
    if (!tabId || isStreaming) return;
    setError("");
    if (lastRecoverableMessage) {
      void retryGeneration(lastRecoverableMessage);
      return;
    }
    if (lastSentContent) {
      void sendContent(lastSentContent);
    }
  }

  async function retryGeneration(message: ChatMessage) {
    if (!tabId || isStreaming) return;
    setError("");
    await sendContent("", { retryMessageId: message.id });
  }

  async function regenerateMessage(messageId: string) {
    if (!tabId || isStreaming) return;
    const oldMessage = messages.find(
      (message) => message.id === messageId && message.role === "assistant"
    );
    if (!oldMessage) return;

    const regenerateWrittenFileNames = [
      ...new Set(
        extractFileMarkers(oldMessage.content)
          .filter((file) => {
            if (hasWrittenFile(oldMessage, file.filename)) return true;
            // 仅无来源协议标记的历史消息可以使用同名文件兜底。
            return (
              oldMessage.fileProvenance?.tracked !== true &&
              !liveMessageIds.current.has(oldMessage.id) &&
              existingFileNames?.includes(file.filename)
            );
          })
          .map((file) => file.filename)
      ),
    ];
    setError("");
    await sendContent("", {
      regenerateMessageId: messageId,
      regenerateWrittenFileNames,
    });
  }

  // ── Keyboard handler ────────────────────────────────────────────────────

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ── Extract file markers from content ───────────────────────────────────

  function renderContentWithMarkers(message: ChatMessage) {
    const { content, id: messageId } = message;
    // Strip internal markers (e.g. %%%SCOPE_FROZEN%%%) that must not reach the user.
    const cleanContent = content
      .replace(/%%%SCOPE_FROZEN%%%/g, "")
      .replace(new RegExp(SCOPE_FREEZE_PROPOSAL_MARKER, "g"), "");
    // 文件标记与 HTML 快照标记联合匹配：两条分支显式展开（不用交替组），
    // 保证 %%%FILE_BEGIN%%% / %%%HTML_BEGIN%%% 字面量完整出现
    // （verify-protocols 按「字面量在行内出现」断言三处一致）。
    // FILE 分支保持与 extractFileMarkers 完全同形的语义（(.+?\.md)\s*\n），
    // 避免双正则漂移；HTML 分支无文件名槽——HTML_BEGIN 后首个非空行即快照
    // 正文（不得吞进捕获组，否则丢首行如 <!DOCTYPE html>）
    const markerRegex =
      /%%%FILE_BEGIN%%%\s*(.+?\.md)\s*\n([\s\S]*?)%%%FILE_END%%%|%%%HTML_BEGIN%%%\s*\n?([\s\S]*?)%%%HTML_END%%%/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = markerRegex.exec(cleanContent)) !== null) {
      // Capture in loop-local constants — the onWrite closure below runs long
      // after the loop, when `match` is already null.
      // FILE 分支命中时 group 1/2 有值；HTML 分支命中时 group 3 有值
      const kind = match[1] !== undefined ? "FILE" : "HTML";
      const filename = (match[1] ?? "").trim();
      const markerContent = (match[2] ?? match[3] ?? "").trim();

      // Text before marker
      if (match.index > lastIndex) {
        parts.push(
          <MarkdownRenderer
            key={key++}
            content={cleanContent.slice(lastIndex, match.index)}
          />
        );
      }
      if (kind === "HTML") {
        // HTML 原型快照：不渲染源码，只提供下载按钮（保对话形态）
        parts.push(
          <HtmlSnapshotBanner key={key++} html={markerContent} />
        );
      } else {
        // File marker
        parts.push(
          <FileMarkerBanner
            key={key++}
            filename={filename}
            written={hasWrittenFile(message, filename)}
              onWrite={() => {
                const pending = {
                  id: `${messageId}-${filename}-manual`,
                  filename,
                  content: markerContent,
                  messageId,
                };
                if (agentType === "ticket_splitter" && PRODUCT_TICKET_RE.test(filename)) {
                  setPendingTicketSet([pending]);
                  setShowTicketSetDialog(true);
                } else {
                  setPendingFiles([pending]);
                  setShowFileDialog(true);
                }
              }}
          />
        );
        // File content (shown inline for now — Ticket 5 will save to filesystem)
        parts.push(<MarkdownRenderer key={key++} content={markerContent} />);
      }
      lastIndex = match.index + match[0].length;
    }

    // Remaining text
    if (lastIndex < cleanContent.length) {
      parts.push(
        <MarkdownRenderer
          key={key++}
          content={cleanContent.slice(lastIndex)}
        />
      );
    }

    return parts.length > 0 ? (
      parts
    ) : (
      <MarkdownRenderer content={cleanContent} />
    );
  }

  /**
   * 流式版 marker 渲染：与 renderContentWithMarkers 同构（同一 marker 语义），
   * 唯一差异在 HTML 分支容忍未闭合——流式中 %%%HTML_END%%% 尚未到达时，
   * 以文本末尾兜底，把 HTML_BEGIN 之后的内容整体视为 HTML 段渲染为占位，
   * 不逐 token 显示源码。流式是幂等重渲染：END 到达的下一 chunk 会重新匹配，
   * 占位与后续文本恢复正常。FILE 分支保持原样流式显示（历史行为，本次只
   * 处理 HTML；仅影响前端显示，不改存储消息——verify 脚本断言走 API 数据）。
   */
  function renderStreamingContent(content: string) {
    // Strip internal markers (e.g. %%%SCOPE_FROZEN%%%) that must not reach the user.
    const cleanContent = content
      .replace(/%%%SCOPE_FROZEN%%%/g, "")
      .replace(new RegExp(SCOPE_FREEZE_PROPOSAL_MARKER, "g"), "");
    // FILE 分支与完成版完全同形；HTML 分支 END 可缺省（流式中尚未到达）
    const markerRegex =
      /%%%FILE_BEGIN%%%\s*(.+?\.md)\s*\n([\s\S]*?)%%%FILE_END%%%|%%%HTML_BEGIN%%%\s*\n?([\s\S]*?)(?:%%%HTML_END%%%|$)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = markerRegex.exec(cleanContent)) !== null) {
      const kind = match[1] !== undefined ? "FILE" : "HTML";
      const markerContent = (match[2] ?? match[3] ?? "").trim();

      // Text before marker
      if (match.index > lastIndex) {
        parts.push(
          <MarkdownRenderer
            key={key++}
            content={cleanContent.slice(lastIndex, match.index)}
          />
        );
      }
      if (kind === "HTML") {
        parts.push(<StreamingHtmlPlaceholder key={key++} />);
      } else {
        parts.push(<MarkdownRenderer key={key++} content={markerContent} />);
      }
      lastIndex = match.index + match[0].length;
    }

    // Remaining text
    if (lastIndex < cleanContent.length) {
      parts.push(
        <MarkdownRenderer
          key={key++}
          content={cleanContent.slice(lastIndex)}
        />
      );
    }

    return parts.length > 0 ? (
      parts
    ) : (
      <MarkdownRenderer content={cleanContent} />
    );
  }

  // ── Empty state: no tab selected ────────────────────────────────────────

  if (!tabId || !tabName) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mb-4 text-5xl">💬</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900">
            选择一个标签页
          </h2>
          <p className="text-sm text-gray-500">
            从上方标签栏选择一个标签页，或新建一个开始工作
          </p>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    // min-h-0：聊天内容超过视口时收缩到容器内，内部消息列表才独立滚动
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      {/* Message list */}
      <div
        ref={scrollContainerRef}
        onScroll={handleMessageScroll}
        onWheel={markUserScrollIntent}
        onTouchMove={markUserScrollIntent}
        onKeyDown={markUserScrollIntent}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6"
      >
        <div className="mx-auto max-w-3xl">
          {/* Loading history */}
          {loadingHistory && (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                加载消息记录...
              </div>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
              <div className="flex items-center justify-between gap-2">
                <span className="flex-1">{error}</span>
                <div className="flex items-center gap-1">
                  {error === TAB_CONFLICT_MESSAGE && tabId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onTabConflict?.(tabId);
                        setError("");
                      }}
                      className="rounded border-red-300 text-red-700 hover:bg-red-100"
                    >
                      刷新标签页
                    </Button>
                  ) : lastSentContent ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRetry}
                      disabled={isStreaming}
                      className="rounded border-red-300 text-red-700 hover:bg-red-100"
                    >
                      重试
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setError("")}
                    className="p-1 text-red-400 hover:text-red-600"
                  >
                    ✕
                  </Button>
                </div>
              </div>
            </div>
          )}

          {freezeStatus === "proposed" && (
            <div className="mb-4 flex items-center justify-between gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span>范围已准备好</span>
              <Button size="sm" onClick={() => void beginScopeFreeze()} disabled={isStreaming}>
                确认冻结
              </Button>
            </div>
          )}
          {freezeStatus === "generating" && (
            <div className="mb-4 flex items-center gap-2 border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
              冻结处理中
            </div>
          )}
          {freezeStatus === "awaiting_write" && (
            <div className="mb-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span>冻结文档已生成，等待写入确认</span>
            </div>
          )}
          {freezeStatus === "failed" && (
            <div className="mb-4 flex items-center justify-between gap-3 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <span>{freezeError || "冻结文档生成失败"}</span>
              <Button size="sm" variant="outline" onClick={() => void beginScopeFreeze()} disabled={isStreaming}>
                重新生成冻结文档
              </Button>
            </div>
          )}
          {freezeStatus === "frozen" && (
            <div className="mb-4 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              范围已正式冻结
            </div>
          )}

          {/* Empty state: no messages yet */}
          {!loadingHistory && messages.length === 0 && (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <div className="mb-4 text-5xl">
                  {agentType ? AGENT_TYPE_ICONS[agentType] : "📝"}
                </div>
                <h2 className="mb-2 text-xl font-semibold text-gray-900">
                  {tabName}
                </h2>
                <p className="mb-3 text-sm text-gray-500">
                  {agentType && AGENT_TYPE_LABELS[agentType]} 已就绪
                </p>
                <p className="max-w-md text-xs leading-relaxed text-gray-400">
                  <span className="font-medium text-gray-500">现在该说什么？</span>
                  {agentType ? ` ${AGENT_TYPE_METADATA[agentType].emptyStatePrompt}` : ""}
                </p>
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isStreaming={msg.status === "generating"}
              onCopy={() => copyMessage(msg.content)}
              onDelete={() => setPendingDeleteMessage(msg)}
              onEdit={
                msg.role === "user" &&
                !isStreaming &&
                !msg.id.startsWith("temp-") &&
                !msg.id.startsWith("interrupted-")
                  ? () => beginEditMessage(msg)
                  : undefined
              }
              onRegenerate={
                !isStreaming &&
                filesReady &&
                msg.role === "assistant" &&
                msg.status === "completed" &&
                msg.id === messages[messages.length - 1]?.id
                  ? () => void regenerateMessage(msg.id)
                  : undefined
              }
              onRetry={
                !isStreaming &&
                msg.role === "assistant" &&
                (msg.status === "failed" || msg.status === "interrupted")
                  ? () => void retryGeneration(msg)
                  : undefined
              }
            >
              {msg.role === "assistant"
                ? msg.status === "generating"
                  ? renderStreamingContent(msg.content)
                  : renderContentWithMarkers(msg)
                : undefined}
            </MessageBubble>
          ))}

        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl">
          {editingMessage && (
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-gray-500">
              <span>正在编辑用户消息</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={cancelEditMessage}
                className="h-7 px-2 text-xs"
              >
                取消编辑
              </Button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
              rows={1}
              className="flex-1 rounded-lg bg-muted px-4 py-2.5"
              style={{ maxHeight: "8rem" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 128) + "px";
              }}
            />
            <Button
              onClick={
                isStreaming
                  ? () => void stopGeneration()
                  : editingMessage
                    ? () => void editAndResendMessage()
                    : sendMessage
              }
              disabled={(!isStreaming && !input.trim()) || (isStreaming && (!activeAssistantMessageId || isStopping))}
              className="shrink-0 rounded-lg px-4 py-2.5 disabled:cursor-not-allowed"
            >
              {isStreaming ? (
                <span className="flex items-center gap-1">
                  <span aria-hidden="true">■</span>
                  {isStopping ? "正在停止" : "停止生成"}
                </span>
              ) : editingMessage ? (
                "重新发送"
              ) : (
                "发送"
              )}
            </Button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
            <span className="text-gray-400">Enter 发送 · Shift+Enter 换行</span>
            {contextUsage !== null && (
              <span
                data-testid="context-usage"
                title="上下文用量为粗略估算"
                className={contextNeedsWarning ? "font-medium text-amber-700" : "text-gray-400"}
              >
                上下文约 {contextUsage.toLocaleString("zh-CN")} / {CONTEXT_TOKEN_LIMIT.toLocaleString("zh-CN")} tokens
                {contextNeedsWarning && <span className="ml-1">接近上限</span>}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 重生成后的文件一致性提示 */}
      <Dialog
        open={fileConsistencyPrompt !== null}
        // 遮罩与 Escape 都已禁止关闭；只允许两个显式决策按钮改变此状态。
        onOpenChange={() => undefined}
      >
        <DialogContent
          className="max-w-md"
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogTitle className="text-base">
            已写入文件与新回复可能不同步
          </DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            新回复不再输出以下已写入文件：
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
            {fileConsistencyPrompt?.staleFileNames.map((filename) => (
              <li key={filename}>{filename}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            更新文件将按新回复中的文件标记进入现有写入确认流程。
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={handleKeepFileConsistency}>
              保持不变
            </Button>
            <Button onClick={handleUpdateFileConsistency}>更新文件</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* File confirmation dialog */}
      <TicketSetConfirmDialog
        open={showTicketSetDialog}
        files={pendingTicketSet}
        saving={savingFile}
        onReplace={() => void deliverTicketSet("replace")}
        onSaveAs={() => void deliverTicketSet("save")}
        onCancel={handleCancelTicketSet}
      />
      <FileConfirmDialog
        key={pendingFiles.map((file) => file.id).join("|")}
        open={showFileDialog}
        files={pendingFiles}
        saving={savingFile}
        onConfirm={handleConfirmFiles}
        onCancel={handleCancelFiles}
      />

      {/* 删除单条消息确认弹窗 */}
      <AlertDialog
        open={pendingDeleteMessage !== null}
        onOpenChange={(open) => {
          if (!open && !deletingMessage) setPendingDeleteMessage(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>确定删除这条消息？</AlertDialogTitle>
          <AlertDialogDescription>
            这条{pendingDeleteMessage?.role === "user" ? "用户" : "AI"}消息将被永久删除，此操作不可恢复。
          </AlertDialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline" disabled={deletingMessage}>
                取消
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={() => void confirmDeleteMessage()}
                disabled={deletingMessage}
              >
                {deletingMessage ? "删除中..." : "删除"}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* AI 服务配置错误弹窗：不进对话区，不提供重试 */}
      <Dialog
        open={!!configError}
        onOpenChange={(o) => {
          if (!o) setConfigError("");
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle className="text-base">AI 服务连接失败</DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            API Key 无效或未配置，无法调用 AI 服务。请检查
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              AI_API_KEY
            </code>
            配置后重试。
          </p>
          <p className="mt-3 max-h-24 overflow-y-auto rounded-md bg-muted px-3 py-2 font-mono text-xs text-gray-500">
            {configError}
          </p>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => setConfigError("")}>知道了</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
