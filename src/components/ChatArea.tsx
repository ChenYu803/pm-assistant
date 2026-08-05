"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentType } from "@/lib/agent-constants";
import { AGENT_TYPE_LABELS } from "@/lib/agent-constants";

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
  onWorkRecordRenamed?: (newName: string) => void;
}

interface SseEvent {
  type: "token" | "done" | "error";
  content?: string;
  messageId?: string;
  message?: string;
  newName?: string;
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

function FileMarkerBanner({ filename }: { filename: string }) {
  return (
    <div className="mx-auto mb-4 max-w-[80%] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-amber-800">
        <span className="text-base">📄</span>
        <span>
          Agent 准备产出文件：<strong>{filename}</strong>
        </span>
      </div>
      <p className="mt-1 text-xs text-amber-600">
        文件将在后续迭代中保存到工作区
      </p>
    </div>
  );
}

// ─── ChatArea ────────────────────────────────────────────────────────────────

export default function ChatArea({
  tabId,
  tabName,
  agentType,
  onWorkRecordRenamed,
}: ChatAreaProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  // ── Send message ─────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || !tabId || isStreaming) return;

    setInput("");
    setError("");

    // Optimistic: add user message to local state
    const optimisticUser: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: trimmed,
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
        body: JSON.stringify({ content: trimmed }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "发送消息失败");
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

        // Split by SSE double-newline
        const parts = buffer.split("\n\n");
        // Keep the last incomplete part in the buffer
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
            case "done":
              setMessages((prev) => [
                ...prev,
                {
                  id: event.messageId || `msg-${Date.now()}`,
                  role: "assistant",
                  content: fullContent,
                  timestamp: new Date().toISOString(),
                },
              ]);
              setStreamingContent("");
              // Check for auto-name result
              if (event.newName && onWorkRecordRenamed) {
                onWorkRecordRenamed(event.newName);
              }
              break;
            case "error":
              setError(event.message || "请求发生错误");
              // If we have partial content, save it
              if (fullContent) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `error-${Date.now()}`,
                    role: "assistant",
                    content: fullContent,
                    timestamp: new Date().toISOString(),
                  },
                ]);
              } else {
                // Remove the optimistic user message if no response at all
                setMessages((prev) =>
                  prev.filter((m) => m.id !== optimisticUser.id)
                );
              }
              setStreamingContent("");
              break;
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
  }, [input, tabId, isStreaming, onWorkRecordRenamed]);

  // ── Keyboard handler ────────────────────────────────────────────────────

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ── Extract file markers from content ───────────────────────────────────

  function renderContentWithMarkers(content: string) {
    const markerRegex = /%%%FILE_BEGIN%%%\s*(.+?\.md)\s*\n([\s\S]*?)%%%FILE_END%%%/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = markerRegex.exec(content)) !== null) {
      // Text before marker
      if (match.index > lastIndex) {
        parts.push(
          <span key={key++}>{content.slice(lastIndex, match.index)}</span>
        );
      }
      // File marker
      parts.push(
        <FileMarkerBanner key={key++} filename={match[1]} />
      );
      // File content (shown inline for now — Ticket 5 will save to filesystem)
      parts.push(
        <span key={key++} className="text-gray-500">
          {match[2]}
        </span>
      );
      lastIndex = match.index + match[0].length;
    }

    // Remaining text
    if (lastIndex < content.length) {
      parts.push(<span key={key++}>{content.slice(lastIndex)}</span>);
    }

    return parts.length > 0 ? parts : content;
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
    <div className="flex flex-1 flex-col bg-gray-50">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
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
              <div className="flex items-center justify-between">
                <span>{error}</span>
                <button
                  onClick={() => setError("")}
                  className="ml-2 text-red-400 hover:text-red-600"
                >
                  ✕
                </button>
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
                        {renderContentWithMarkers(msg.content)}
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
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
              style={{ maxHeight: "8rem" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 128) + "px";
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isStreaming ? (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  思考中
                </span>
              ) : (
                "发送"
              )}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            Enter 发送 · Shift+Enter 换行
          </p>
        </div>
      </div>
    </div>
  );
}
