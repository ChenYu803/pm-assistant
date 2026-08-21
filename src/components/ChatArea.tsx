"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { AgentType } from "@/lib/agent-constants";
import {
  AGENT_TYPE_ICONS,
  AGENT_TYPE_LABELS,
  AGENT_TYPE_METADATA,
} from "@/lib/agent-constants";
import FileConfirmDialog, {
  type FileToConfirm,
  type PendingFile,
} from "@/components/FileConfirmDialog";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { isWorkingDocFile } from "@/lib/file-helpers";
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
}

interface ChatAreaProps {
  tabId: string | null;
  tabName: string | null;
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
}

interface SseEvent {
  type: "token" | "done" | "error";
  content?: string;
  messageId?: string;
  message?: string;
  newName?: string;
  interrupted?: boolean;
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

/** 将对话中的内部协议标记转换为用户可复制的纯文本。 */
function toCopyText(content: string): string {
  return content
    .replace(/%%%SCOPE_FROZEN%%%/g, "")
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
  onRegenerate,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  children?: ReactNode;
  onCopy?: () => Promise<void>;
  onDelete?: () => void;
  onRegenerate?: () => void;
}) {
  const isUser = message.role === "user";
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
        </div>

        {!isStreaming && (onCopy || onDelete || onRegenerate) && (
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
  tabName,
  agentType,
  projectId,
  existingFileNames,
  filesReady = true,
  onWorkRecordRenamed,
  onFileSaved,
}: ChatAreaProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState("");
  // 配置类错误（API key 无效/未配置）——弹窗提示，不进对话区，也不提供重试
  const [configError, setConfigError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  // Last sent content — state, not a ref: it's read during render (retry button)
  const [lastSentContent, setLastSentContent] = useState("");
  const [pendingDeleteMessage, setPendingDeleteMessage] =
    useState<ChatMessage | null>(null);
  const [deletingMessage, setDeletingMessage] = useState(false);
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
  const [savingFile, setSavingFile] = useState(false);
  // Track processed message IDs to avoid re-showing dialogs
  const processedFileMessageIds = useRef<Set<string>>(new Set());
  // 本会话内实时产生（SSE done 事件）的 assistant 消息 id。历史重放扫描 effect
  // 在 done 处理器的 setTimeout(100) 之前（effect 内 setTimeout(0)）就会跑，
  // 若扫描把实时消息也当历史处理，「文件名已存在 → 跳过」的兜底会吞掉新消息
  // 的写入判定——实时消息必须走「消息是否已写入」判定，不做文件名兜底
  // （v1.1 文件更新修复）。id 全局唯一（ObjectId），切 tab 后无需清理。
  const liveMessageIds = useRef<Set<string>>(new Set());
  // Messages whose file has actually been written (banner shows "已写入").
  // State, not a ref — it's read during render.
  const [writtenFileMessageIds, setWrittenFileMessageIds] = useState<Set<string>>(new Set());
  const pendingFileSequence = useRef(0);

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
      sourceMessageId: string | null
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
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "保存文件失败");
        }
        // Mark the source message as written so its banner shows "已写入"
        // (prevents accidental duplicate appends from re-clicking).
        if (sourceMessageId) {
          setWrittenFileMessageIds((prev) => new Set(prev).add(sourceMessageId));
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

  /**
   * Check a message for file markers and trigger confirmation dialog.
   * historyReplay = true：历史重放（页面刷新 / 重新加载）扫描路径，文件名已存在
   * 视为「该消息的写入已落盘」→ 不重复弹确认框（文件名兜底，仅此路径使用）。
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
        // 同一回复可能同时带工作文档与正式文件 marker（如推进时既更新工作文档
        // 又输出需求分析.md）：工作文档静默写入，正式文件入队逐个弹确认框
        // （02: 任务拆分 Agent 一次输出多个 issue 文件，在同一弹窗中批量处理）。
        const pending: PendingFile[] = [];
        markers.forEach((m, index) => {
          if (isWorkingDocFile(m.filename)) {
            void writeFileToServer(m, message.id);
            return;
          }
          if (historyReplay && existingFileNames?.includes(m.filename)) {
            // 历史重放：文件名已存在 = 该消息的写入已落盘 → 不重复弹框；
            // 横幅保留手动「写入项目文件」供有意重写（现状语义不变）。
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
    [existingFileNames, writeFileToServer]
  );

  // ── Fetch message history on tab change ──────────────────────────────────

  useEffect(() => {
    if (!tabId) {
      const reset = window.setTimeout(() => setMessages([]), 0);
      return () => window.clearTimeout(reset);
    }

    let cancelled = false;

    async function fetchMessages() {
      setLoadingHistory(true);
      setError("");
      try {
        const res = await fetch(`/api/tabs/${tabId}/messages`);
        if (!res.ok) throw new Error("获取消息记录失败");
        const data = await res.json();
        if (!cancelled) {
          setMessages(data.messages);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "获取消息记录失败");
        }
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    }

    fetchMessages();
    return () => {
      cancelled = true;
      // Abort any in-progress stream when switching tabs
      abortRef.current?.abort();
      setIsStreaming(false);
      setStreamingContent("");
    };
  }, [tabId]);

  // ── Smart auto-scroll ────────────────────────────────────────────────────

  const handleMessageScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    shouldAutoScrollRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight <= 96;
  }, []);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent]);

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

  async function handleConfirmFiles(files: PendingFile[]) {
    if (!projectId || !agentType) return;
    const failed: PendingFile[] = [];
    for (const pending of files) {
      if (!(await writeFileToServer(pending, pending.messageId))) {
        failed.push(pending);
      }
    }
    setPendingFiles(failed);
    setShowFileDialog(failed.length > 0);
  }

  function handleCancelFiles() {
    // 未勾选或主动丢弃的文件不请求写入 API，保留「拒绝不落盘」语义。
    setPendingFiles([]);
    setShowFileDialog(false);
  }

  // ── Core send logic (shared by sendMessage and retry) ───────────────────

  async function sendContent(
    content: string,
    options?: { regenerateMessageId?: string }
  ) {
    if (!tabId || isStreaming) return;

    setError("");
    stopRequestedRef.current = false;

    const regenerateMessageId = options?.regenerateMessageId;
    if (!regenerateMessageId) {
      const optimisticUser: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticUser]);
    }

    setIsStreaming(true);
    setStreamingContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/tabs/${tabId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          regenerateMessageId
            ? { regenerate: true, messageId: regenerateMessageId }
            : { content }
        ),
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

      if (regenerateMessageId) {
        setMessages((prev) =>
          prev.filter((message) => message.id !== regenerateMessageId)
        );
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

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
              if (event.content) {
                fullContent += event.content;
                setStreamingContent(fullContent);
              }
              break;
            case "done": {
              const newMsg: ChatMessage = {
                id: event.messageId || `msg-${Date.now()}`,
                role: "assistant",
                content: fullContent,
                timestamp: new Date().toISOString(),
              };
              // 先登记再 setMessages：历史扫描 effect 在 setMessages 触发的
              // 重渲染后（setTimeout 0）就会跑，必须让它跳过这条实时消息，
              // 由下面的 setTimeout(100) 以「消息级已写入」判定处理。
              liveMessageIds.current.add(newMsg.id);
              setMessages((prev) => [
                ...prev.filter((message) => message.id !== regenerateMessageId),
                newMsg,
              ]);
              setTimeout(() => checkAndShowFileDialog(newMsg), 100);
              setStreamingContent("");
              if (event.newName && onWorkRecordRenamed) {
                onWorkRecordRenamed(event.newName);
              }
              break;
            }
            case "error": {
              const errMsg = event.message || "请求发生错误";
              if (isConfigError(errMsg)) {
                setConfigError(errMsg);
              } else {
                setError(errMsg);
              }
              if (event.messageId && fullContent && !stopRequestedRef.current) {
                // Server persisted the partial — append with the real message
                // id so a later history fetch doesn't duplicate it.
                setMessages((prev) => [
                  ...prev.filter((message) => message.id !== regenerateMessageId),
                  {
                    id: event.messageId!,
                    role: "assistant",
                    content:
                      fullContent +
                      `\n\n[${event.interrupted ? "回复已中断" : "回复因错误中断"}]`,
                    timestamp: new Date().toISOString(),
                  },
                ]);
              }
              // Without a server id: the user message was already persisted
              // server-side, so keep the optimistic copy — deleting it would
              // make it (and the failed state) reappear after a refresh.
              setStreamingContent("");
              break;
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "发送消息失败");
      setStreamingContent("");
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  function stopGeneration() {
    if (!isStreaming) return;
    stopRequestedRef.current = true;
    const partial = streamingContent.trim();
    if (partial) {
      setMessages((prev) => [
        ...prev,
        {
          id: `interrupted-${Date.now()}`,
          role: "assistant",
          content: `${streamingContent}\n\n[回复已中断]`,
          timestamp: new Date().toISOString(),
        },
      ]);
    }
    setStreamingContent("");
    setIsStreaming(false);
    abortRef.current?.abort();
    abortRef.current = null;
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
    if (!pendingDeleteMessage || deletingMessage) return;
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
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "删除消息失败");
      }
      setMessages((prev) => prev.filter((item) => item.id !== message.id));
      setPendingDeleteMessage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除消息失败");
    } finally {
      setDeletingMessage(false);
    }
  }

  // ── Send message ─────────────────────────────────────────────────────────

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || !tabId || isStreaming) return;

    setInput("");
    setLastSentContent(trimmed);
    await sendContent(trimmed);
  }

  // ── Retry handler ────────────────────────────────────────────────────────

  function handleRetry() {
    const content = lastSentContent;
    if (!content || !tabId || isStreaming) return;
    setError("");
    void sendContent(content);
  }

  async function regenerateMessage(messageId: string) {
    if (!tabId || isStreaming) return;
    setError("");
    await sendContent("", { regenerateMessageId: messageId });
  }

  // ── Keyboard handler ────────────────────────────────────────────────────

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ── Extract file markers from content ───────────────────────────────────

  function renderContentWithMarkers(content: string, messageId: string) {
    // Strip internal markers (e.g. %%%SCOPE_FROZEN%%%) that must not reach the user.
    const cleanContent = content.replace(/%%%SCOPE_FROZEN%%%/g, "");
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
            written={writtenFileMessageIds.has(messageId)}
              onWrite={() => {
              setPendingFiles([
                {
                  id: `${messageId}-${filename}-manual`,
                  filename,
                  content: markerContent,
                  messageId,
                },
              ]);
              setShowFileDialog(true);
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
    const cleanContent = content.replace(/%%%SCOPE_FROZEN%%%/g, "");
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
                  {lastSentContent && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRetry}
                      disabled={isStreaming}
                      className="rounded border-red-300 text-red-700 hover:bg-red-100"
                    >
                      重试
                    </Button>
                  )}
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
              isStreaming={false}
              onCopy={() => copyMessage(msg.content)}
              onDelete={() => setPendingDeleteMessage(msg)}
              onRegenerate={
                !isStreaming &&
                msg.role === "assistant" &&
                msg.id === messages[messages.length - 1]?.id
                  ? () => void regenerateMessage(msg.id)
                  : undefined
              }
            >
              {msg.role === "assistant"
                ? renderContentWithMarkers(msg.content, msg.id)
                : undefined}
            </MessageBubble>
          ))}

          {/* Streaming message */}
          {isStreaming && streamingContent && (
            <div className="mb-4 flex justify-start">
              <div className="flex max-w-[80%] gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm text-gray-700">
                  AI
                </div>
                <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm leading-relaxed text-gray-900">
                  <div className="whitespace-pre-wrap break-words">
                    {renderStreamingContent(streamingContent)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Thinking indicator (streaming started but no content yet) */}
          {isStreaming && !streamingContent && (
            <div className="mb-4 flex justify-start">
              <div className="flex max-w-[80%] gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm text-gray-700">
                  AI
                </div>
                <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-gray-400">正在思考</span>
                    <span className="flex gap-0.5">
                      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl">
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
              onClick={isStreaming ? stopGeneration : sendMessage}
              disabled={!isStreaming && !input.trim()}
              className="shrink-0 rounded-lg px-4 py-2.5 disabled:cursor-not-allowed"
            >
              {isStreaming ? (
                <span className="flex items-center gap-1">
                  <span aria-hidden="true">■</span>
                  停止生成
                </span>
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

      {/* File confirmation dialog */}
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
