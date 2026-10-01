"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getWorkbenchFileStage } from "@/lib/workbench-file-branch";
import ProjectFileTree, { type ProjectFileEntry } from "@/components/ProjectFileTree";
import MarkdownCandidateReview, { type MarkdownCandidate } from "@/components/MarkdownCandidateReview";
import TaskSetCandidateReview, { type TaskSetCandidate } from "@/components/TaskSetCandidateReview";
import TaskSetManualProposal from "@/components/TaskSetManualProposal";
import DisclosureIcon from "@/components/DisclosureIcon";
import PrototypeSnapshotPanel from "@/components/PrototypeSnapshotPanel";
import IterationWriteSummary from "@/components/IterationWriteSummary";
import SessionDeleteDialog from "@/components/SessionDeleteDialog";

type StageKey = "analysis" | "prototype" | "prd" | "tickets";
type StageStatus = "not_started" | "in_progress" | "completed";
type Stage = { key: StageKey; status: StageStatus; sessions: Session[]; generatingSessionIds: string[] };
type Session = { id: string; title: string; updatedAt?: string };
type Message = { id: string; role: "user" | "assistant"; content: string; displayContent?: string; status?: string; errorMessage?: string | null; timestamp?: string; candidate?: MarkdownCandidate; taskCandidate?: TaskSetCandidate };
type Project = { id: string; name: string };
type Iteration = { id: string; project_id: string; iteration_number: number; display_name: string; goal: string | null };
type FileRecord = ProjectFileEntry;
type DemoSession = { id: string; title: string; messages: ["user" | "assistant", string][] };

function preferredSession(iterationId: string, stage: StageKey, entries: Session[]) {
  try {
    const rememberedId = window.sessionStorage.getItem(`stage-session:${iterationId}:${stage}`);
    return entries.find((session) => session.id === rememberedId) ?? entries[0] ?? null;
  } catch {
    return entries[0] ?? null;
  }
}

function rememberSession(iterationId: string, stage: StageKey, sessionId: string) {
  try { window.sessionStorage.setItem(`stage-session:${iterationId}:${stage}`, sessionId); } catch { /* 浏览器禁用会话存储时仍可正常切换。 */ }
}

const stageInfo: { key: StageKey; label: string; agent: string; hint: string }[] = [
  { key: "analysis", label: "需求分析", agent: "需求分析 Agent", hint: "从你想解决的问题开始，逐步确认用户、场景与验证依据。" },
  { key: "prototype", label: "原型设计", agent: "原型设计 Agent", hint: "把已确认的问题转成页面结构、用户流程与交互方案。" },
  { key: "prd", label: "PRD", agent: "PRD Agent", hint: "整理产品范围和实现规则，形成可交付的产品需求文档。" },
  { key: "tickets", label: "任务拆分", agent: "任务拆分 Agent", hint: "把已确认的产品方案拆成有依赖关系、可逐项验收的任务。" },
];

const stageOrder: StageKey[] = stageInfo.map((stage) => stage.key);

function statusLabel(status: StageStatus | undefined) {
  return status === "completed" ? "已完成" : status === "in_progress" ? "进行中" : "未开始";
}

function Icon({ name }: { name: "copy" | "edit" | "refresh" | "close" | "file" | "plus" | "panel" | "trash" }) {
  const paths: Record<string, React.ReactNode> = {
    copy: <><rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></>,
    edit: <><path d="M12 20h9"/><path d="m16.5 3.5 4 4L8 20H4v-4Z"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M15 4v16"/></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function ProductIterationWorkbench({ project, iteration, demoSessions = [] }: { project: Project; iteration: Iteration; demoSessions?: DemoSession[] }) {
  const base = `/api/iterations/${iteration.id}`;
  const [currentStage, setCurrentStage] = useState<StageKey>("analysis");
  const [stages, setStages] = useState<Stage[]>(stageInfo.map(({ key }) => ({ key, status: "not_started", sessions: [], generatingSessionIds: [] })));
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [contextBySession, setContextBySession] = useState<Record<string, string[]>>({});
  const [contextTab, setContextTab] = useState<"tree" | "context" | "snapshots" | "writes">("tree");
  const [writeRevision, setWriteRevision] = useState(0);
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  const [focusSnapshotMessageId, setFocusSnapshotMessageId] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(true);
  const [compactView, setCompactView] = useState<"conversation" | "sessions" | "files">("conversation");
  const [workbenchReady, setWorkbenchReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesFailed, setMessagesFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ target: StageKey; missing: StageKey } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingSessionIds, setSendingSessionIds] = useState<string[]>([]);
  const [creatingSession, setCreatingSession] = useState(false);
  const [deletingSession, setDeletingSession] = useState<{ session: Session; stage: StageKey } | null>(null);
  const [stageUpdating, setStageUpdating] = useState(false);
  const [stoppingGeneration, setStoppingGeneration] = useState(false);
  const [contextUpdating, setContextUpdating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [demoId, setDemoId] = useState<string | null>(null);
  const [demoExpanded, setDemoExpanded] = useState(true);
  const [toast, setToast] = useState("");
  const messageList = useRef<HTMLDivElement>(null);
  const loadSequence = useRef(0);
  const messageVersion = useRef(0);
  const activeView = useRef<{ stage: StageKey; sessionId: string | null }>({ stage: "analysis", sessionId: null });
  const sendingIds = useRef(new Set<string>());
  const stoppedIds = useRef(new Set<string>());
  const creatingSessionRef = useRef(false);

  const currentInfo = stageInfo.find((stage) => stage.key === currentStage) ?? stageInfo[0];
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const selectedDemo = demoSessions.find((session) => session.id === demoId) ?? null;
  const input = activeSessionId ? drafts[activeSessionId] ?? "" : "";
  const sending = activeSessionId ? sendingSessionIds.includes(activeSessionId) : false;
  const contextIds = activeSessionId ? contextBySession[activeSessionId] ?? [] : [];
  const loadedFiles = files.filter((file) => !file.deleted && contextIds.includes(file.id));
  const currentStageState = stages.find((stage) => stage.key === currentStage);
  const currentStatus = currentStageState?.status ?? "not_started";
  const generatingSessionIds = currentStageState?.generatingSessionIds ?? [];
  const busySessionIds = new Set([...generatingSessionIds, ...sessions.filter((session) => sendingSessionIds.includes(session.id)).map((session) => session.id)]);
  const busySessions = sessions.filter((session) => busySessionIds.has(session.id));
  const otherBusySessions = busySessions.filter((session) => session.id !== activeSessionId || Boolean(selectedDemo));
  const stageGenerating = busySessionIds.size > 0;
  const sessionGenerating = Boolean(activeSessionId && (sending || generatingSessionIds.includes(activeSessionId)));

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "请求未完成，请重试。");
    return body;
  }, []);

  const refreshCandidateState = useCallback(async (sessionId: string, stage: StageKey) => {
    const [history, fileList] = await Promise.all([
      request(`${base}/stages/${stage}/sessions/${sessionId}/messages`),
      request(`/api/projects/${project.id}/files`),
    ]);
    setFiles(fileList);
    setWriteRevision((value) => value + 1);
    if (activeView.current.stage === stage && activeView.current.sessionId === sessionId) {
      messageVersion.current += 1;
      setMessages(history.messages);
    }
  }, [base, project.id, request]);

  const loadWorkbench = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [state, fileList] = await Promise.all([
        request(`${base}/workbench`),
        request(`/api/projects/${project.id}/files`),
      ]);
      setStages(state.stages);
      setWorkbenchReady(true);
      setCurrentStage(state.currentStage);
      if (window.matchMedia("(max-width: 1100px)").matches) {
        setContextOpen(false);
        setDemoExpanded(false);
      }
      setSessions(state.stages.find((stage: Stage) => stage.key === state.currentStage)?.sessions ?? []);
      setFiles(fileList);
      const activeState = state.stages.find((stage: Stage) => stage.key === state.currentStage);
      const restoredSession = preferredSession(iteration.id, state.currentStage, activeState?.sessions ?? []);
      activeView.current = { stage: state.currentStage, sessionId: restoredSession?.id ?? null };
      setActiveSessionId(restoredSession?.id ?? null);
      setMessagesLoading(Boolean(restoredSession));
      setDemoId(null);
      setMessages([]);
      setContextBySession({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "工作台加载失败。");
    } finally {
      setLoading(false);
    }
  }, [base, iteration.id, project.id, request]);

  const refreshStageFacts = useCallback(async () => {
    const state = await request(`${base}/workbench`);
    setStages((previous) => previous.map((entry) => {
      const actual = state.stages.find((stage: Stage) => stage.key === entry.key);
      return actual ? { ...entry, status: actual.status, generatingSessionIds: actual.generatingSessionIds } : entry;
    }));
    return state;
  }, [base, request]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadWorkbench(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkbench]);

  useEffect(() => {
    if (!stages.some((stage) => stage.generatingSessionIds.length > 0)) return;
    const timer = window.setInterval(() => { void refreshStageFacts().catch(() => undefined); }, 2000);
    return () => window.clearInterval(timer);
  }, [refreshStageFacts, stages]);

  const loadMessages = useCallback(async (sessionId: string | null) => {
    const requestSequence = ++loadSequence.current;
    const startedAtMessageVersion = messageVersion.current;
    setMessages([]);
    setEditingId(null);
    setMessagesLoading(Boolean(sessionId));
    setMessagesFailed(false);
    if (!sessionId) return;
    try {
      const [history, context] = await Promise.all([
        request(`${base}/stages/${currentStage}/sessions/${sessionId}/messages`),
        request(`${base}/stages/${currentStage}/sessions/${sessionId}/context`),
      ]);
      if (requestSequence !== loadSequence.current || activeView.current.sessionId !== sessionId || activeView.current.stage !== currentStage) return;
      if (startedAtMessageVersion === messageVersion.current) setMessages(history.messages);
      setContextBySession((previous) => ({ ...previous, [sessionId]: context.fileIds }));
    } catch (caught) {
      if (requestSequence === loadSequence.current) {
        setMessagesFailed(true);
        setError(caught instanceof Error ? caught.message : "会话内容加载失败。");
      }
    } finally {
      if (requestSequence === loadSequence.current) setMessagesLoading(false);
    }
  }, [base, currentStage, request]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadMessages(activeSessionId); }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSessionId, loadMessages]);
  useEffect(() => {
    const node = messageList.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, demoId]);

  function showToast(value: string) {
    setToast(value);
    window.setTimeout(() => setToast(""), 2200);
  }

  function openContextPanel() {
    setContextOpen(true);
    setCompactView("files");
  }

  function closeContextPanel() {
    setContextOpen(false);
    setCompactView("conversation");
  }

  function navigateContextTabs(event: React.KeyboardEvent<HTMLDivElement>) {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].click();
    buttons[next].focus();
  }

  async function enterStage(key: StageKey, bypass = false) {
    setCompactView("conversation");
    setNotice(null);
    if (!bypass) {
      const index = stageOrder.indexOf(key);
      const missing = stageOrder.slice(0, index).find((prior) => {
        const state = stages.find((stage) => stage.key === prior);
        return state?.status !== "completed" && !files.some((file) => !file.deleted && getWorkbenchFileStage(file.filename) === prior);
      });
      if (missing) { setNotice({ target: key, missing }); return; }
    }
    loadSequence.current += 1;
    setMessages([]);
    setEditingId(null);
    setCurrentStage(key);
    if (key !== "prototype") setContextTab((previous) => previous === "snapshots" ? "tree" : previous);
    setDemoId(null);
    const stage = stages.find((entry) => entry.key === key);
    const nextSessions = stage?.sessions ?? [];
    const nextSession = preferredSession(iteration.id, key, nextSessions);
    activeView.current = { stage: key, sessionId: nextSession?.id ?? null };
    setSessions(nextSessions);
    setActiveSessionId(nextSession?.id ?? null);
    setMessagesLoading(Boolean(nextSession));
    setStageUpdating(true);
    try {
      const result = await request(`${base}/workbench`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: key, ...(nextSession ? { sessionId: nextSession.id } : {}) }) });
      if (result.status) setStages((previous) => previous.map((entry) => entry.key === key ? { ...entry, status: result.status } : entry));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "阶段位置保存失败。"); }
    finally { setStageUpdating(false); }
  }

  async function createSession() {
    if (creatingSessionRef.current) return;
    creatingSessionRef.current = true;
    setCreatingSession(true);
    const stage = currentStage;
    const startingSelection = loadSequence.current;
    try {
      const result = await request(`${base}/stages/${stage}/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const session = result.session as Session;
      setStages((previous) => previous.map((entry) => entry.key === stage ? { ...entry, status: "in_progress", sessions: [session, ...entry.sessions] } : entry));
      if (activeView.current.stage === stage) setSessions((previous) => [session, ...previous]);
      if (activeView.current.stage !== stage || loadSequence.current !== startingSelection) return;
      activeView.current = { stage, sessionId: session.id };
      rememberSession(iteration.id, stage, session.id);
      loadSequence.current += 1;
      setMessages([]);
      setEditingId(null);
      setActiveSessionId(session.id);
      setMessagesLoading(true);
      setDemoId(null);
      setCompactView("conversation");
    } catch (caught) {
      if (activeView.current.stage === stage) setError(caught instanceof Error ? caught.message : "创建会话失败。");
    } finally {
      creatingSessionRef.current = false;
      setCreatingSession(false);
    }
  }

  async function chooseSession(session: Session) {
    setCompactView("conversation");
    if (activeView.current.stage === currentStage && activeView.current.sessionId === session.id && !demoId && currentStatus !== "completed") return;
    loadSequence.current += 1;
    activeView.current = { stage: currentStage, sessionId: session.id };
    rememberSession(iteration.id, currentStage, session.id);
    setMessages([]);
    setEditingId(null);
    setDemoId(null);
    setActiveSessionId(session.id);
    setMessagesLoading(true);
    try {
      const result = await request(`${base}/workbench`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: currentStage, sessionId: session.id }) });
      if (result.status) setStages((previous) => previous.map((entry) => entry.key === currentStage ? { ...entry, status: result.status } : entry));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "会话打开失败。"); }
  }

  function viewGeneratingSession(session: Session) {
    void chooseSession(session);
  }

  async function completeStage() {
    if (stageUpdating || stageGenerating || currentStatus !== "in_progress") return;
    setStageUpdating(true);
    setError("");
    try {
      await request(`${base}/stages/${currentStage}/complete`, { method: "POST" });
      setStages((previous) => previous.map((entry) => entry.key === currentStage ? { ...entry, status: "completed" } : entry));
      showToast(`${currentInfo.label}已完成`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "完成阶段失败。");
      await refreshStageFacts().catch(() => undefined);
    } finally { setStageUpdating(false); }
  }

  async function reopenStage() {
    const session = activeSession ?? currentStageState?.sessions[0];
    if (!session || stageUpdating) return;
    setStageUpdating(true);
    setError("");
    try {
      const result = await request(`${base}/workbench`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: currentStage, sessionId: session.id }) });
      setStages((previous) => previous.map((entry) => entry.key === currentStage ? { ...entry, status: result.status } : entry));
      if (!activeSession) {
        activeView.current = { stage: currentStage, sessionId: session.id };
        rememberSession(iteration.id, currentStage, session.id);
        setDemoId(null);
        setActiveSessionId(session.id);
      }
      showToast(`${currentInfo.label}已重新打开`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "重新打开阶段失败。"); }
    finally { setStageUpdating(false); }
  }

  async function stopGeneration() {
    if (!activeSessionId || stoppingGeneration) return;
    const sessionId = activeSessionId;
    setStoppingGeneration(true);
    setError("");
    try {
      await request(`${base}/sessions/${sessionId}/stop`, { method: "POST" });
      stoppedIds.current.add(sessionId);
      await refreshStageFacts();
      if (activeView.current.sessionId === sessionId) await loadMessages(sessionId);
      showToast("生成已停止");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "停止生成失败。"); }
    finally { setStoppingGeneration(false); }
  }

  async function sendMessage(content: string, editMessageId?: string, regenerateMessageId?: string) {
    if (!activeSessionId || messagesLoading || messagesFailed || currentStatus === "completed" || (!content.trim() && !regenerateMessageId) || sendingIds.current.has(activeSessionId)) return;
    const sessionId = activeSessionId;
    const stage = currentStage;
    sendingIds.current.add(sessionId);
    stoppedIds.current.delete(sessionId);
    setSendingSessionIds([...sendingIds.current]);
    setError("");
    try {
      let latestMessages: Message[] = [];
      if (editMessageId) {
        await request(`${base}/sessions/${sessionId}/messages/${editMessageId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: content.trim() }),
        });
        const history = await request(`${base}/stages/${stage}/sessions/${sessionId}/messages`);
        latestMessages = history.messages;
        if (activeView.current.stage === stage && activeView.current.sessionId === sessionId) {
          messageVersion.current += 1;
          setMessages(history.messages);
        }
      } else {
        const result = await request(`${base}/stages/${stage}/sessions/${sessionId}/messages`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...(content.trim() ? { content: content.trim() } : {}), ...(regenerateMessageId ? { regenerateMessageId } : {}) }),
        });
        latestMessages = result.messages;
        if (activeView.current.stage === stage && activeView.current.sessionId === sessionId) {
          messageVersion.current += 1;
          setMessages(result.messages);
        }
      }
      if (!editMessageId && !regenerateMessageId) setDrafts((previous) => ({ ...previous, [sessionId]: "" }));
      if (stage === "prototype") {
        const latest = [...latestMessages].reverse().find((message) => message.role === "assistant" && message.status === "completed");
        if (latest?.content.includes("%%%HTML_BEGIN%%%") && activeView.current.stage === stage && activeView.current.sessionId === sessionId) {
          setSnapshotRevision((previous) => previous + 1);
          setFocusSnapshotMessageId(latest.id);
          setContextTab("snapshots");
          openContextPanel();
        }
      }
      if (activeView.current.stage === stage && activeView.current.sessionId === sessionId) { setEditingId(null); setEditValue(""); }
      const updated = await request(`${base}/sessions/${sessionId}`).catch(() => null);
      if (updated) {
        const updateSession = (session: Session) => session.id === sessionId ? { ...session, title: updated.title, updatedAt: updated.updated_at } : session;
        setStages((previous) => previous.map((entry) => entry.key === stage ? { ...entry, sessions: entry.sessions.map(updateSession) } : entry));
        if (activeView.current.stage === stage) setSessions((previous) => previous.map(updateSession));
      }
    } catch (caught) {
      if (!stoppedIds.current.has(sessionId) && activeView.current.stage === stage && activeView.current.sessionId === sessionId) {
        setError(caught instanceof Error ? caught.message : "消息发送失败。");
        await loadMessages(sessionId).catch(() => undefined);
      }
    } finally {
      sendingIds.current.delete(sessionId);
      setSendingSessionIds([...sendingIds.current]);
      await refreshStageFacts().catch(() => undefined);
    }
  }

  const toggleContext = useCallback(async (fileId: string, add: boolean) => {
    if (contextUpdating) return;
    if (!activeSessionId) {
      setToast("请先开始本阶段工作。");
      window.setTimeout(() => setToast(""), 2200);
      return;
    }
    const sessionId = activeSessionId;
    const stage = currentStage;
    setContextUpdating(true);
    try {
      const result = await request(`${base}/stages/${stage}/sessions/${sessionId}/context`, {
        method: add ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId }),
      });
      setContextBySession((previous) => ({ ...previous, [sessionId]: result.fileIds }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上下文更新失败。");
    } finally {
      setContextUpdating(false);
    }
  }, [activeSessionId, base, contextUpdating, currentStage, request]);

  function selectDemo(id: string) {
    setCompactView("conversation");
    loadSequence.current += 1;
    activeView.current = { stage: currentStage, sessionId: null };
    setActiveSessionId(null);
    setDemoId(id);
    setMessages([]);
    setEditingId(null);
    setMessagesLoading(false);
  }

  function finishSessionDeletion(session: Session, stage: StageKey) {
    setStages((previous) => previous.map((entry) => entry.key === stage ? {
      ...entry, sessions: entry.sessions.filter((item) => item.id !== session.id), generatingSessionIds: entry.generatingSessionIds.filter((id) => id !== session.id),
    } : entry));
    setDrafts((previous) => { const next = { ...previous }; delete next[session.id]; return next; });
    setContextBySession((previous) => { const next = { ...previous }; delete next[session.id]; return next; });
    try {
      const key = `stage-session:${iteration.id}:${stage}`;
      if (window.sessionStorage.getItem(key) === session.id) window.sessionStorage.removeItem(key);
    } catch { /* 禁用会话存储时仍清理界面内的选择。 */ }
    if (activeView.current.stage === stage) {
      const remaining = sessions.filter((item) => item.id !== session.id);
      setSessions(remaining);
      if (activeView.current.sessionId === session.id) {
        const nextSession = preferredSession(iteration.id, stage, remaining);
        loadSequence.current += 1;
        activeView.current = { stage, sessionId: nextSession?.id ?? null };
        if (nextSession) rememberSession(iteration.id, stage, nextSession.id);
        setActiveSessionId(nextSession?.id ?? null);
        setMessages([]); setEditingId(null); setEditValue(""); setMessagesLoading(Boolean(nextSession));
      }
    }
    setDeletingSession(null);
    showToast("会话已删除，已保存的项目成果与变更记录仍保留。");
  }

  const currentDemoMessages = useMemo(() => selectedDemo?.messages ?? [], [selectedDemo]);
  const lastUserId = [...messages].reverse().find((message) => message.role === "user")?.id;
  const lastAssistantId = [...messages].reverse().find((message) => message.role === "assistant")?.id;

  return <main className="iteration-workbench" aria-busy={loading}>
    <div className="workbench-shell">
      <header className="workbench-header">
        <div className="workbench-identity">
          <span className="workbench-brand"><span className="workbench-mark">A</span><span>AI 产品现场</span></span>
          <span className="workbench-divider" aria-hidden="true" />
          <div className="workbench-project"><strong title={iteration.display_name}>{iteration.display_name}</strong><span>{toast ? <span className="workbench-feedback" role="status" title={toast}>{toast}</span> : <><span title={project.name}>{project.name}</span><b>{`产品迭代 ${String(iteration.iteration_number).padStart(2, "0")}`}</b></>}</span></div>
        </div>
        <div className="workbench-header-actions">{!contextOpen && <button className="workbench-quiet-button file-toggle" type="button" onClick={openContextPanel} aria-expanded="false" aria-controls="workbench-files"><Icon name="panel"/>展开文件区</button>}<Link href="/projects" className="workbench-back">返回迭代管理</Link></div>
      </header>

      <section className="workbench-stage-area" aria-label="四环阶段导航">
        <nav className="workbench-stage-nav">
          {stageInfo.map((stage, index) => { const status = stages.find((item) => item.key === stage.key)?.status; return <button key={stage.key} className="workbench-stage" type="button" disabled={creatingSession || contextUpdating || stageUpdating} aria-current={currentStage === stage.key ? "step" : undefined} onClick={() => void enterStage(stage.key)}>
            <span className="stage-index">{String(index + 1).padStart(2, "0")}</span><span className="stage-title">{stage.label}</span><span className="stage-status" data-status={status ?? "not_started"}>{statusLabel(status)}</span>
          </button>; })}
        </nav>
        {notice && <div className="workbench-notice" role="status"><div><strong>还没有确认的{stageInfo.find((stage) => stage.key === notice.missing)?.label}成果</strong><p>直接进入{stageInfo.find((stage) => stage.key === notice.target)?.label}，可能会缺少前置依据。你仍可以继续。</p></div><div className="notice-actions"><button type="button" onClick={() => void enterStage(notice.missing, true)}>返回{stageInfo.find((stage) => stage.key === notice.missing)?.label}</button><button className="notice-continue" type="button" onClick={() => void enterStage(notice.target, true)}>继续进入{stageInfo.find((stage) => stage.key === notice.target)?.label}</button></div></div>}
      </section>

      {error && <div className="workbench-error" role="alert"><span>{error}</span>{!workbenchReady ? <button type="button" disabled={loading} onClick={() => void loadWorkbench()}>重新加载工作台</button> : <button type="button" onClick={() => setError("")}>关闭</button>}</div>}
      <nav className="workbench-view-nav" aria-label="工作台区域">
        <button type="button" disabled={loading || !workbenchReady} aria-pressed={compactView === "conversation"} aria-controls="workbench-conversation" onClick={() => setCompactView("conversation")}>对话</button>
        <button type="button" disabled={loading || !workbenchReady} aria-pressed={compactView === "sessions"} aria-controls="workbench-sessions" onClick={() => setCompactView("sessions")}>阶段会话 <span>{sessions.length}</span></button>
        <button type="button" disabled={loading || !workbenchReady} aria-pressed={compactView === "files"} aria-controls="workbench-files" onClick={openContextPanel}>文件与上下文 <span>{contextIds.length}</span></button>
      </nav>
      {loading ? <div className="workbench-loading" role="status" aria-label="正在加载工作台"><div/><div/><div/></div> : !workbenchReady ? <div className="workbench-unavailable"><h2>工作台未能加载</h2><p>请重新加载后继续，项目成果不会受影响。</p></div> : <div className={`workbench-grid ${contextOpen ? "" : "context-collapsed"}`} data-compact-view={compactView}>
        <aside className="workbench-sessions" id="workbench-sessions" aria-label="阶段会话">
          <div className="sessions-heading"><h2>阶段会话</h2><button className="new-session-button" type="button" disabled={creatingSession || contextUpdating} onClick={() => void createSession()} aria-label="新建会话" title="新建会话"><Icon name="plus"/></button></div>
          {sessions.length ? <div className="real-session-list">{sessions.map((session) => <div className="session-list-item" key={session.id}>
            <button className="session-row" data-session-id={session.id} type="button" title={session.title} disabled={contextUpdating} aria-current={activeSessionId === session.id ? "page" : undefined} onClick={() => void chooseSession(session)}><strong>{session.title}</strong><small>{generatingSessionIds.includes(session.id) || sendingSessionIds.includes(session.id) ? "生成中 · " : session.title === "新会话" ? "尚无消息 · " : ""}{session.updatedAt ? new Date(session.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}</small></button>
            <button className="session-delete-button" type="button" disabled={contextUpdating || creatingSession || stageUpdating} aria-label={`删除会话：${session.title}`} title={`删除会话：${session.title}`} onClick={() => setDeletingSession({ session, stage: currentStage })}><Icon name="trash" /></button>
          </div>)}</div> : <p className="session-empty">本阶段还没有会话，可新建会话开始。</p>}
          {demoSessions.length > 0 && currentStage === "analysis" ? <details className="demo-section" open={demoExpanded} onToggle={(event) => setDemoExpanded(event.currentTarget.open)}><summary className="demo-divider disclosure-summary"><span>演示会话</span><small>只读样例</small><DisclosureIcon /></summary>
          <div className="demo-session-list">{demoSessions.map((session) => <button key={session.id} type="button" className="demo-session" disabled={contextUpdating} aria-current={demoId === session.id ? "page" : undefined} onClick={() => selectDemo(session.id)}><strong>{session.title}</strong><small>{session.messages.length} 条示例消息</small></button>)}</div></details> : null}
        </aside>

        <section className="workbench-conversation" id="workbench-conversation" aria-labelledby="conversation-title">
          <div className="conversation-heading"><div className="conversation-identity"><span>对话 · {currentInfo.label}</span><h2 id="conversation-title" title={activeSession?.title ?? selectedDemo?.title ?? currentInfo.label}>{activeSession?.title ?? selectedDemo?.title ?? currentInfo.label}</h2></div>
            {!selectedDemo && currentStatus === "in_progress" && currentStageState?.sessions.length ? <button className="stage-complete-button" type="button" disabled={stageUpdating || Boolean(stageGenerating)} aria-describedby={stageGenerating ? "stage-generation-note" : undefined} onClick={() => void completeStage()}>完成本阶段</button> : null}
            {!selectedDemo && currentStatus === "completed" ? <button className="stage-reopen-button" type="button" disabled={stageUpdating} onClick={() => void reopenStage()}>重新打开阶段</button> : null}
          </div>
          {currentStatus === "in_progress" && stageGenerating ? <div className="stage-generation-note" id="stage-generation-note" role="status">
            <span>{busySessionIds.size === 1 && busySessions.length === 1 ? `「${busySessions[0].title}」正在生成，结束或停止后可完成本阶段。` : `本阶段有 ${busySessionIds.size} 个会话正在生成，结束或停止后可完成本阶段。`}</span>
            {otherBusySessions.length ? <div className="stage-generation-links">{otherBusySessions.map((session) => <button key={session.id} type="button" disabled={contextUpdating} onClick={() => viewGeneratingSession(session)} title={`查看生成中的会话：${session.title}`}>{busySessions.length === 1 ? "查看会话" : session.title}</button>)}</div> : busySessions.length ? null : <span>刷新页面后可查看该会话。</span>}
          </div> : null}
          <div className="workbench-message-list" ref={messageList} aria-live="polite">
            {selectedDemo ? <div className="demo-warning">这是只读样例会话，不会保存到你的阶段会话。</div> : null}
            {!activeSession && !selectedDemo ? <div className="stage-empty"><div><h3>从你想解决的问题开始。</h3><p>{currentInfo.hint}</p><button type="button" disabled={creatingSession || contextUpdating} onClick={() => void createSession()}>开始本阶段工作</button></div></div> : null}
            {activeSession && messagesLoading ? <p className="session-loading" role="status">正在打开会话…</p> : null}
            {activeSession && messagesFailed ? <div className="stage-empty session-start"><h3>会话内容未能加载</h3><p>消息与上下文尚未读取，请重试后继续。</p><button type="button" onClick={() => { setError(""); void loadMessages(activeSessionId); }}>重新加载会话</button></div> : null}
            {activeSession && !messagesLoading && !messagesFailed && messages.length === 0 ? <div className="stage-empty session-start"><h3>这个会话还没有消息</h3><p>{currentInfo.hint}</p></div> : null}
            {(selectedDemo ? currentDemoMessages.map(([role, content], index): Message => ({ id: `demo-${index}`, role, content })) : messages).map((message) => <article className={`workbench-message ${message.role}${(message.candidate || message.taskCandidate) ? " has-candidate" : ""}`} key={message.id}>
              <div className="message-label">{message.role === "user" ? "你" : currentInfo.agent}{message.status === "generating" ? <span> · 生成中</span> : message.status === "failed" ? <span> · {message.errorMessage === "生成已停止" ? "已停止" : "生成失败"}</span> : null}</div>
              {editingId === message.id ? <div className="inline-message-edit"><textarea aria-label="修改这条消息" value={editValue} onChange={(event) => setEditValue(event.target.value)}/><div><button type="button" onClick={() => { setEditingId(null); setEditValue(""); }}>取消</button><button type="button" disabled={!editValue.trim() || sending || currentStatus === "completed"} onClick={() => void sendMessage(editValue, message.id)}>发送</button></div></div> : <><div className="message-content">{message.status === "failed" && !message.content ? message.errorMessage ?? "生成失败" : message.displayContent ?? message.content}</div>{message.candidate && activeSessionId ? <MarkdownCandidateReview candidate={message.candidate} stage={currentStage === "prototype" ? "prototype" : "analysis"} iterationId={iteration.id} sessionId={activeSessionId} files={files.filter((file) => !file.deleted)} onDecided={() => refreshCandidateState(activeSessionId, currentStage)} /> : null}{message.taskCandidate && activeSessionId ? <TaskSetCandidateReview candidate={message.taskCandidate} iterationId={iteration.id} sessionId={activeSessionId} onDecided={() => refreshCandidateState(activeSessionId, currentStage)} /> : null}{currentStage === "prototype" && message.role === "assistant" && message.status === "completed" && message.content.includes("%%%HTML_BEGIN%%%") ? <button className="message-snapshot-link" type="button" onClick={() => { setFocusSnapshotMessageId(message.id); setContextTab("snapshots"); openContextPanel(); }}>打开本轮 HTML 快照</button> : null}{!selectedDemo && <div className="message-actions"><button type="button" title="复制消息" aria-label="复制消息" onClick={() => { void navigator.clipboard.writeText(message.displayContent ?? message.content).then(() => showToast("已复制消息")).catch(() => showToast("复制失败，请手动选择文本")); }}><Icon name="copy"/></button>{message.role === "user" && message.id === lastUserId && <button type="button" title="修改并重新发送" aria-label="修改并重新发送" disabled={currentStatus === "completed" || sending} onClick={() => { setEditingId(message.id); setEditValue(message.taskCandidate ? message.displayContent ?? "" : message.content); }}><Icon name="edit"/></button>}{message.role === "assistant" && message.id === lastAssistantId && <button type="button" title={message.status === "failed" ? "重试生成" : "重新生成"} aria-label={message.status === "failed" ? "重试生成" : "重新生成"} disabled={sending || currentStatus === "completed" || !["completed", "failed"].includes(message.status ?? "")} onClick={() => void sendMessage("", undefined, message.id)}><Icon name="refresh"/></button>}</div>}</>}
            </article>)}
          </div>
          {currentStage === "tickets" && activeSessionId && !selectedDemo && currentStatus !== "completed" && !sessionGenerating ? <TaskSetManualProposal key={activeSessionId} iterationId={iteration.id} sessionId={activeSessionId} onCreated={() => refreshCandidateState(activeSessionId, currentStage)} /> : null}
          <form className="workbench-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(input); }}>
            <button className="composer-context-button" type="button" onClick={() => { setContextTab("context"); openContextPanel(); }}>当前上下文 · {loadedFiles.length} 个文件</button>
            <textarea value={input} onChange={(event) => { if (activeSessionId) setDrafts((previous) => ({ ...previous, [activeSessionId]: event.target.value })); }} disabled={!activeSession || sessionGenerating || currentStatus === "completed" || Boolean(selectedDemo) || messagesLoading || messagesFailed} placeholder={selectedDemo ? "演示会话为只读" : currentStatus === "completed" ? "重新打开阶段后可继续讨论" : messagesFailed ? "重新加载会话后可继续讨论" : activeSession ? "写下你现在想讨论的问题或判断……" : "开始本阶段工作后即可发送消息"} aria-label="输入消息"/>
            <div>{sessionGenerating ? <button className="stop-generation-button" type="button" disabled={stoppingGeneration} onClick={() => void stopGeneration()}>{stoppingGeneration ? "正在停止…" : "停止生成"}</button> : null}<button type="submit" disabled={!activeSession || !input.trim() || sessionGenerating || currentStatus === "completed" || messagesLoading || messagesFailed}>{sending ? "发送中…" : "发送消息"}</button></div>
          </form>
        </section>

        {contextOpen && <aside className="workbench-context" id="workbench-files" aria-label="项目文件与上下文">
          <div className="context-heading"><h2>文件与上下文</h2><button type="button" className="context-close" aria-label="关闭文件区" title="关闭文件区" onClick={closeContextPanel}><Icon name="close"/></button></div>
          <div className="context-switch" role="tablist" aria-label="文件视图" onKeyDown={navigateContextTabs}>{([
            ["tree", "项目文件树", files.filter((file) => !file.deleted).length],
            ["context", "当前上下文", contextIds.length], ["writes", "本轮写入", null],
            ...(currentStage === "prototype" ? [["snapshots", "HTML 快照", null] as const] : []),
          ] as const).map(([tab, label, count]) => <button key={tab} id={`context-tab-${tab}`} type="button" role="tab" aria-controls="context-tab-panel" tabIndex={contextTab === tab ? 0 : -1} aria-selected={contextTab === tab} onClick={() => setContextTab(tab)}>{label}{count !== null && <span>{count}</span>}</button>)}</div>
          <div className="context-tab-panel" id="context-tab-panel" role="tabpanel" aria-labelledby={`context-tab-${contextTab}`} tabIndex={0}>
          {contextTab === "snapshots" && currentStage === "prototype" ? <PrototypeSnapshotPanel projectId={project.id} iterationId={iteration.id} revision={snapshotRevision} focusMessageId={focusSnapshotMessageId} /> : contextTab === "writes" ? <IterationWriteSummary iterationId={iteration.id} revision={writeRevision} /> : contextTab === "tree" ? <div className="context-scroll">
            <p className="context-guidance">{activeSessionId ? "在文件树中加入上下文；打开预览不会自动加入。" : "请先开始阶段会话，才能加入文件。预览不会自动加入。"}</p>
            <ProjectFileTree
              projectId={project.id}
              iterationId={iteration.id}
              files={files}
              onChanged={() => { setWriteRevision((value) => value + 1); void request(`/api/projects/${project.id}/files`).then((directory: FileRecord[]) => {
                setFiles(directory);
                const liveIds = new Set(directory.filter((file) => !file.deleted).map((file) => file.id));
                setContextBySession((previous) => Object.fromEntries(Object.entries(previous).map(([sessionId, ids]) => [sessionId, ids.filter((id) => liveIds.has(id))])));
              }).catch(() => showToast("文件已保存，目录刷新失败，请重新打开工作台")); }}
              onAddToContext={(fileId) => void toggleContext(fileId, true)}
              loadedFileIds={contextIds}
              addDisabled={!activeSessionId || messagesLoading || messagesFailed || contextUpdating}
              addDisabledReason={!activeSessionId ? "请先开始阶段会话" : messagesLoading ? "正在加载会话" : messagesFailed ? "请先重新加载会话" : contextUpdating ? "正在更新上下文" : undefined}
            />
          </div> : <div className="context-scroll">
            <p className="context-guidance">{activeSessionId ? "这里只显示已加入文件。移除后，Agent 下一轮不再读取其正文。" : "请先开始阶段会话，再从项目文件树加入文件。"}</p>
            {!loadedFiles.length && <p className="context-empty">{activeSessionId ? "当前上下文为空，Agent 看得到文件目录，但看不到文件正文。" : "当前没有可管理的上下文文件。"}</p>}
            {loadedFiles.map((file) => <div className="project-file-row loaded" key={file.id}>
              <span title={file.filename}><Icon name="file"/><span className="context-file-info"><strong>{file.filename}</strong><small>最近写入：{file.lastContentIteration ?? "未记录"} · {file.canUndo ? "可撤回" : "不可撤回"}</small></span></span>
              <button type="button" disabled={messagesLoading || messagesFailed || contextUpdating} onClick={() => void toggleContext(file.id, false)} aria-label={`从当前上下文移除 ${file.filename}`}>移除</button>
            </div>)}
          </div>}
          </div>
        </aside>}
      </div>}
    </div>
    {deletingSession ? <SessionDeleteDialog key={deletingSession.session.id} iterationId={iteration.id} session={deletingSession.session}
      generating={sendingSessionIds.includes(deletingSession.session.id) || stages.some((stage) => stage.generatingSessionIds.includes(deletingSession.session.id))}
      onClose={() => setDeletingSession(null)} onDeleted={() => finishSessionDeletion(deletingSession.session, deletingSession.stage)}
      onViewGeneration={() => { const session = deletingSession.session; setDeletingSession(null); viewGeneratingSession(session); void refreshStageFacts().catch(() => undefined); }} /> : null}
  </main>;
}
