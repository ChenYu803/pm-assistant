"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentType } from "@/lib/agent-constants";
import { AGENT_TYPE_LABELS } from "@/lib/agent-constants";
import FileConfirmDialog, {
  type FileToConfirm,
} from "@/components/FileConfirmDialog";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

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
}

/**
 * 配置类错误（API key 无效/未配置等）无法通过重试解决，走弹窗提示；
 * 其余错误（网络中断、超时等）保留对话区 banner + 重试。
 */
function isConfigError(message: string): boolean {
  return /401|authentication|api[ _-]?key|DEEPSEEK_API_KEY|invalid_api_key/i.test(
    message
  );
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
}: {
  message: ChatMessage | { role: "assistant"; content: string; id?: string; timestamp?: string };
  isStreaming: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div className={`flex max-w-[80%] gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
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
            {message.content}
            {isStreaming && (
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-current align-text-bottom" />
            )}
          </div>
        </div>
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Last sent content — state, not a ref: it's read during render (retry button)
  const [lastSentContent, setLastSentContent] = useState("");

  // File confirmation state
  const [fileToConfirm, setFileToConfirm] = useState<FileToConfirm | null>(null);
  const [showFileDialog, setShowFileDialog] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  // Track processed message IDs to avoid re-showing dialogs
  const processedFileMessageIds = useRef<Set<string>>(new Set());
  // Messages whose file has actually been written (banner shows "已写入").
  // State, not a ref — it's read during render.
  const [writtenFileMessageIds, setWrittenFileMessageIds] = useState<Set<string>>(new Set());
  // Which message triggered the currently open confirm dialog
  const pendingWriteMessageId = useRef<string | null>(null);

  // ── File marker parsing (extractFileMarkers lives at module level) ────────

  /** Check a message for file markers and trigger confirmation dialog. */
  const checkAndShowFileDialog = useCallback(
    (message: ChatMessage) => {
      if (processedFileMessageIds.current.has(message.id)) return;
      const markers = extractFileMarkers(message.content);
      if (markers.length > 0) {
        processedFileMessageIds.current.add(message.id);
        // File already exists (e.g. after a page reload) — don't re-ask for a
        // completed write (spec US39); the banner stays for intentional re-writes.
        if (existingFileNames?.includes(markers[0].filename)) return;
        pendingWriteMessageId.current = message.id;
        setFileToConfirm(markers[0]); // Show first marker; user can process more later
        setShowFileDialog(true);
      }
    },
    [existingFileNames]
  );

  // ── Fetch message history on tab change ──────────────────────────────────

  useEffect(() => {
    if (!tabId) {
      setMessages([]);
      return;
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

  // ── Auto-scroll to bottom ────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // ── Scan history for file markers (tab re-open) ─────────────────────────
  // Waits for the project file list to finish loading (filesReady): otherwise
  // a slow file fetch would race the message history and re-ask for a write
  // the user already confirmed (the file simply isn't in existingFileNames yet).
  useEffect(() => {
    if (!tabId || !filesReady || loadingHistory) return;
    // setTimeout 延迟到宏任务：effect 内同步 setState 会触发级联渲染（lint 规则），
    // 弹窗推迟一帧对用户无感知；与 done 事件的 setTimeout 先例一致。
    const t = setTimeout(() => {
      for (const msg of messages) {
        if (msg.role === "assistant") checkAndShowFileDialog(msg);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [tabId, filesReady, loadingHistory, messages, checkAndShowFileDialog]);

  // ── File confirmation handlers ────────────────────────────────────────────

  async function handleConfirmFile() {
    if (!fileToConfirm || !projectId || !agentType) return;
    setSavingFile(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: fileToConfirm.filename,
          content: fileToConfirm.content,
          agent_type: agentType,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "保存文件失败");
      }
      // Mark the source message as written so its banner shows "已写入"
      // (prevents accidental duplicate appends from re-clicking).
      if (pendingWriteMessageId.current) {
        const writtenId = pendingWriteMessageId.current;
        setWrittenFileMessageIds((prev) => new Set(prev).add(writtenId));
      }
      setShowFileDialog(false);
      setFileToConfirm(null);
      onFileSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存文件失败");
    } finally {
      setSavingFile(false);
    }
  }

  function handleCancelFile() {
    setShowFileDialog(false);
    setFileToConfirm(null);
  }

  // ── Core send logic (shared by sendMessage and retry) ───────────────────

  async function sendContent(content: string) {
    if (!tabId || isStreaming) return;

    setError("");

    const optimisticUser: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    setIsStreaming(true);
    setStreamingContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/tabs/${tabId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
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
              setMessages((prev) => [...prev, newMsg]);
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
              if (event.messageId && fullContent) {
                // Server persisted the partial — append with the real message
                // id so a later history fetch doesn't duplicate it.
                setMessages((prev) => [
                  ...prev,
                  {
                    id: event.messageId!,
                    role: "assistant",
                    content: fullContent,
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

  // ── Send message ─────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || !tabId || isStreaming) return;

    setInput("");
    setLastSentContent(trimmed);
    await sendContent(trimmed);
  }, [input, tabId, isStreaming, onWorkRecordRenamed]);

  // ── Retry handler ────────────────────────────────────────────────────────

  function handleRetry() {
    const content = lastSentContent;
    if (!content || !tabId || isStreaming) return;
    setError("");
    void sendContent(content);
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
    const markerRegex = /%%%FILE_BEGIN%%%\s*(.+?\.md)\s*\n([\s\S]*?)%%%FILE_END%%%/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = markerRegex.exec(cleanContent)) !== null) {
      // Capture in loop-local constants — the onWrite closure below runs long
      // after the loop, when `match` is already null.
      const filename = match[1].trim();
      const fileContent = match[2].trim();

      // Text before marker
      if (match.index > lastIndex) {
        parts.push(
          <MarkdownRenderer
            key={key++}
            content={cleanContent.slice(lastIndex, match.index)}
          />
        );
      }
      // File marker
      parts.push(
        <FileMarkerBanner
          key={key++}
          filename={filename}
          written={writtenFileMessageIds.has(messageId)}
          onWrite={() => {
            pendingWriteMessageId.current = messageId;
            setFileToConfirm({ filename, content: fileContent });
            setShowFileDialog(true);
          }}
        />
      );
      // File content (shown inline for now — Ticket 5 will save to filesystem)
      parts.push(<MarkdownRenderer key={key++} content={fileContent} />);
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
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
                  {agentType === "requirement_analyst" ? "📋" : "📝"}
                </div>
                <h2 className="mb-2 text-xl font-semibold text-gray-900">
                  {tabName}
                </h2>
                <p className="mb-3 text-sm text-gray-500">
                  {agentType && AGENT_TYPE_LABELS[agentType]} 已就绪
                </p>
                <p className="text-xs text-gray-400">
                  {agentType === "requirement_analyst"
                    ? "请描述您想做的产品或想解决的问题，我将通过系统化的流程帮您梳理需求。"
                    : "请提供需求分析文档，我将帮您生成 MVP 版本的 PRD。"}
                </p>
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.role === "assistant" ? (
                <div className="mb-4 flex justify-start">
                  <div className="flex max-w-[80%] gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm text-gray-700">
                      AI
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm leading-relaxed text-gray-900">
                      <div className="whitespace-pre-wrap break-words">
                        {renderContentWithMarkers(msg.content, msg.id)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <MessageBubble message={msg} isStreaming={false} />
              )}
            </div>
          ))}

          {/* Streaming message */}
          {isStreaming && streamingContent && (
            <MessageBubble
              message={{ role: "assistant", content: streamingContent }}
              isStreaming={true}
            />
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
              disabled={isStreaming}
              className="flex-1 rounded-lg bg-muted px-4 py-2.5"
              style={{ maxHeight: "8rem" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 128) + "px";
              }}
            />
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
              className="shrink-0 rounded-lg px-4 py-2.5 disabled:cursor-not-allowed"
            >
              {isStreaming ? (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  思考中
                </span>
              ) : (
                "发送"
              )}
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            Enter 发送 · Shift+Enter 换行
          </p>
        </div>
      </div>

      {/* File confirmation dialog */}
      <FileConfirmDialog
        open={showFileDialog}
        file={fileToConfirm}
        saving={savingFile}
        onConfirm={handleConfirmFile}
        onCancel={handleCancelFile}
      />

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
              DEEPSEEK_API_KEY
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
