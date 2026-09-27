"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getWorkbenchFileStage } from "@/lib/workbench-file-branch";

type StageKey = "analysis" | "prototype" | "prd" | "tickets";
type StageStatus = "not_started" | "in_progress" | "completed";
type Stage = { key: StageKey; status: StageStatus; sessions: Session[]; generatingSessionIds: string[] };
type Session = { id: string; title: string; updatedAt?: string };
type Message = { id: string; role: "user" | "assistant"; content: string; status?: string; errorMessage?: string | null; timestamp?: string };
type Project = { id: string; name: string };
type Iteration = { id: string; project_id: string; iteration_number: number; display_name: string; goal: string | null };
type FileRecord = { id: string; filename: string; version?: number; updated_at?: string };

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

const demoSessions = [
  { id: "demo-goal", title: "目标与验证依据", messages: [
    ["user", "我们现在只有访谈笔记，没有量化数据。"], ["assistant", "先把访谈中的重复信号标出来，再区分事实、推测和待验证假设。"], ["user", "最常出现的是“不知道从哪里开始”。"], ["assistant", "这可以成为首个问题假设。你知道用户通常在什么时刻遇到这个问题吗？"], ["user", "大多是第一次创建项目时，面对空白页面不知道先做什么。"], ["assistant", "那问题可能不只是缺少说明，也可能是起步任务和下一步不够明确。"], ["user", "我们希望用户能完成一轮完整的产品思考。"], ["assistant", "这是产品目标。可以再拆成首次进入、需求澄清、形成方案等可观察步骤。"], ["user", "初步成功标准是十分钟内能说清四个阶段分别做什么。"], ["assistant", "已记录为待验证标准。还需要通过新手测试确认用户能独立复述并完成一次阶段选择。"],
  ] as ["user" | "assistant", string][] },
  { id: "demo-first-use", title: "用户首次进入产品", messages: [["assistant", "先把目标从“让用户理解产品”拆成可观察的行为结果。"], ["user", "我希望第一次打开产品的人，十分钟内理解 AI 产品经理的工作方式。"], ["assistant", "可以先验证：用户能否说出 AI PM 与传统 PM 的差异，并完成一次从需求到交付的判断。"]] as ["user" | "assistant", string][] },
  { id: "demo-scope", title: "范围取舍记录", messages: [["assistant", "当前阶段先确认用户与成功标准，再讨论具体方案。"], ["user", "那是否先不讨论技术实现？"], ["assistant", "是。先记录约束和判断依据，技术方案留到后续阶段。"]] as ["user" | "assistant", string][] },
];

const stageOrder: StageKey[] = stageInfo.map((stage) => stage.key);

function statusLabel(status: StageStatus | undefined) {
  return status === "completed" ? "已完成" : status === "in_progress" ? "进行中" : "未开始";
}

function Icon({ name }: { name: "copy" | "edit" | "refresh" | "close" | "file" | "plus" | "panel" }) {
  const paths: Record<string, React.ReactNode> = {
    copy: <><rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></>,
    edit: <><path d="M12 20h9"/><path d="m16.5 3.5 4 4L8 20H4v-4Z"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M15 4v16"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function ProductIterationWorkbench({ project, iteration }: { project: Project; iteration: Iteration }) {
  const base = `/api/iterations/${iteration.id}`;
  const [currentStage, setCurrentStage] = useState<StageKey>("analysis");
  const [stages, setStages] = useState<Stage[]>(stageInfo.map(({ key }) => ({ key, status: "not_started", sessions: [], generatingSessionIds: [] })));
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [contextBySession, setContextBySession] = useState<Record<string, string[]>>({});
  const [contextTab, setContextTab] = useState<"tree" | "context">("tree");
  const [contextOpen, setContextOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ target: StageKey; missing: StageKey } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingSessionIds, setSendingSessionIds] = useState<string[]>([]);
  const [creatingSession, setCreatingSession] = useState(false);
  const [stageUpdating, setStageUpdating] = useState(false);
  const [stoppingGeneration, setStoppingGeneration] = useState(false);
  const [contextUpdating, setContextUpdating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [demoId, setDemoId] = useState<string | null>(null);
  const [demoExpanded, setDemoExpanded] = useState(true);
  const [toast, setToast] = useState("");
  const messageList = useRef<HTMLDivElement>(null);
  const contextPanel = useRef<HTMLElement>(null);
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
  const currentStageState = stages.find((stage) => stage.key === currentStage);
  const currentStatus = currentStageState?.status ?? "not_started";
  const generatingSessionIds = currentStageState?.generatingSessionIds ?? [];
  const stageGenerating = currentStageState?.sessions.some((session) => sendingSessionIds.includes(session.id)) || generatingSessionIds.length > 0;
  const sessionGenerating = Boolean(activeSessionId && (sending || generatingSessionIds.includes(activeSessionId)));

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "请求未完成，请重试。");
    return body;
  }, []);

  const loadWorkbench = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [state, fileList] = await Promise.all([
        request(`${base}/workbench`),
        request(`/api/projects/${project.id}/files`),
      ]);
      setStages(state.stages);
      setCurrentStage(state.currentStage);
      if (window.matchMedia("(max-width: 760px)").matches) {
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
      if (requestSequence === loadSequence.current) setError(caught instanceof Error ? caught.message : "会话内容加载失败。");
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
    if (window.matchMedia("(max-width: 760px)").matches) {
      window.setTimeout(() => contextPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }
  }

  async function enterStage(key: StageKey, bypass = false) {
    setNotice(null);
    if (!bypass) {
      const index = stageOrder.indexOf(key);
      const missing = stageOrder.slice(0, index).find((prior) => {
        const state = stages.find((stage) => stage.key === prior);
        return state?.status !== "completed" && !files.some((file) => getWorkbenchFileStage(file.filename) === prior);
      });
      if (missing) { setNotice({ target: key, missing }); return; }
    }
    loadSequence.current += 1;
    setMessages([]);
    setEditingId(null);
    setCurrentStage(key);
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
    } catch (caught) {
      if (activeView.current.stage === stage) setError(caught instanceof Error ? caught.message : "创建会话失败。");
    } finally {
      creatingSessionRef.current = false;
      setCreatingSession(false);
    }
  }

  async function chooseSession(session: Session) {
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
    if (!activeSessionId || currentStatus === "completed" || (!content.trim() && !regenerateMessageId) || sendingIds.current.has(activeSessionId)) return;
    const sessionId = activeSessionId;
    const stage = currentStage;
    sendingIds.current.add(sessionId);
    stoppedIds.current.delete(sessionId);
    setSendingSessionIds([...sendingIds.current]);
    setError("");
    try {
      if (editMessageId) {
        await request(`${base}/sessions/${sessionId}/messages/${editMessageId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: content.trim() }),
        });
        const history = await request(`${base}/stages/${stage}/sessions/${sessionId}/messages`);
        if (activeView.current.stage === stage && activeView.current.sessionId === sessionId) {
          messageVersion.current += 1;
          setMessages(history.messages);
        }
      } else {
        const result = await request(`${base}/stages/${stage}/sessions/${sessionId}/messages`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...(content.trim() ? { content: content.trim() } : {}), ...(regenerateMessageId ? { regenerateMessageId } : {}) }),
        });
        if (activeView.current.stage === stage && activeView.current.sessionId === sessionId) {
          messageVersion.current += 1;
          setMessages(result.messages);
        }
      }
      if (!editMessageId && !regenerateMessageId) setDrafts((previous) => ({ ...previous, [sessionId]: "" }));
      if (activeView.current.stage === stage && activeView.current.sessionId === sessionId) { setEditingId(null); setEditValue(""); }
      const updated = await request(`${base}/sessions/${sessionId}`).catch(() => null);
      if (updated) {
        const updateSession = (session: Session) => session.id === sessionId ? { ...session, title: updated.title, updatedAt: updated.updated_at } : session;
        setStages((previous) => previous.map((entry) => entry.key === stage ? { ...entry, sessions: entry.sessions.map(updateSession) } : entry));
        if (activeView.current.stage === stage) setSessions((previous) => previous.map(updateSession));
      }
    } catch (caught) {
      if (!stoppedIds.current.has(sessionId) && activeView.current.stage === stage && activeView.current.sessionId === sessionId) setError(caught instanceof Error ? caught.message : "消息发送失败。");
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
    loadSequence.current += 1;
    activeView.current = { stage: currentStage, sessionId: null };
    setActiveSessionId(null);
    setDemoId(id);
    setMessages([]);
    setEditingId(null);
    setMessagesLoading(false);
  }

  const currentDemoMessages = useMemo(() => selectedDemo?.messages ?? [], [selectedDemo]);
  const groupedFiles = useMemo(() => {
    const groups = new Map<string, FileRecord[]>();
    files.forEach((file) => {
      const branch = stageInfo.find((stage) => stage.key === getWorkbenchFileStage(file.filename))?.label ?? "需求分析";
      groups.set(branch, [...(groups.get(branch) ?? []), file]);
    });
    return [...groups.entries()];
  }, [files]);

  const lastUserId = [...messages].reverse().find((message) => message.role === "user")?.id;
  const lastAssistantId = [...messages].reverse().find((message) => message.role === "assistant" && message.status === "completed")?.id;

  return <main className="iteration-workbench" aria-busy={loading}>
    <div className="workbench-shell">
      <header className="workbench-header">
        <div className="workbench-identity">
          <span className="workbench-brand"><span className="workbench-mark">A</span><span>AI 产品现场</span></span>
          <span className="workbench-divider" aria-hidden="true" />
          <div className="workbench-project"><strong>{iteration.display_name}</strong><span>{project.name}<b>{`迭代 ${String(iteration.iteration_number).padStart(2, "0")}`}</b></span></div>
        </div>
        <div className="workbench-header-actions">{!contextOpen && <button className="workbench-quiet-button file-toggle" type="button" onClick={openContextPanel} aria-expanded="false"><Icon name="panel"/>展开文件区</button>}<Link href="/projects" className="workbench-back">返回迭代管理</Link></div>
      </header>

      <section className="workbench-stage-area" aria-label="四环阶段导航">
        <nav className="workbench-stage-nav">
          {stageInfo.map((stage, index) => { const status = stages.find((item) => item.key === stage.key)?.status; return <button key={stage.key} className="workbench-stage" type="button" disabled={creatingSession || contextUpdating || stageUpdating} aria-current={currentStage === stage.key ? "step" : undefined} onClick={() => void enterStage(stage.key)}>
            <span className="stage-index">{String(index + 1).padStart(2, "0")}</span><span className="stage-title">{stage.label}</span><span className="stage-status" data-status={status ?? "not_started"}>{statusLabel(status)}</span>
          </button>; })}
        </nav>
        {notice && <div className="workbench-notice" role="status"><div><strong>还没有确认的{stageInfo.find((stage) => stage.key === notice.missing)?.label}成果</strong><p>直接进入{stageInfo.find((stage) => stage.key === notice.target)?.label}，可能会缺少前置依据。你仍可以继续。</p></div><div className="notice-actions"><button type="button" onClick={() => void enterStage(notice.missing, true)}>返回{stageInfo.find((stage) => stage.key === notice.missing)?.label}</button><button className="notice-continue" type="button" onClick={() => void enterStage(notice.target, true)}>继续进入{stageInfo.find((stage) => stage.key === notice.target)?.label}</button></div></div>}
      </section>

      {error && <div className="workbench-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>关闭</button></div>}
      {loading ? <div className="workbench-loading" aria-label="正在加载工作台"><span/><span/><span/></div> : <div className={`workbench-grid ${contextOpen ? "" : "context-collapsed"}`}>
        <aside className="workbench-sessions" aria-label="阶段会话">
          <div className="sessions-heading"><h2>阶段会话</h2><button className="new-session-button" type="button" disabled={creatingSession || contextUpdating} onClick={() => void createSession()} aria-label="新建会话" title="新建会话"><Icon name="plus"/></button></div>
          {sessions.length ? <div className="real-session-list">{sessions.map((session) => <button key={session.id} className="session-row" type="button" disabled={contextUpdating} aria-current={activeSessionId === session.id ? "page" : undefined} onClick={() => void chooseSession(session)}><strong>{session.title}</strong><small>{generatingSessionIds.includes(session.id) || sendingSessionIds.includes(session.id) ? "生成中 · " : session.title === "新会话" ? "尚无消息 · " : ""}{session.updatedAt ? new Date(session.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}</small></button>)}</div> : <p className="session-empty">本阶段还没有会话</p>}
          {currentStage === "analysis" ? <details className="demo-section" open={demoExpanded} onToggle={(event) => setDemoExpanded(event.currentTarget.open)}><summary className="demo-divider"><span>演示会话</span><small>不属于你的项目</small></summary>
          <div className="demo-session-list">{demoSessions.map((session) => <button key={session.id} type="button" className="demo-session" disabled={contextUpdating} aria-current={demoId === session.id ? "page" : undefined} onClick={() => selectDemo(session.id)}><strong>{session.title}</strong><small>{session.messages.length} 条示例消息</small></button>)}</div></details> : null}
        </aside>

        <section className="workbench-conversation" aria-labelledby="conversation-title">
          <div className="conversation-heading"><h2 id="conversation-title">{activeSession?.title ?? selectedDemo?.title ?? currentInfo.label}</h2>
            {currentStatus === "in_progress" && currentStageState?.sessions.length ? <button className="stage-complete-button" type="button" disabled={stageUpdating || Boolean(stageGenerating)} aria-describedby={stageGenerating ? "stage-generation-note" : undefined} onClick={() => void completeStage()}>完成本阶段</button> : null}
            {currentStatus === "completed" ? <button className="stage-reopen-button" type="button" disabled={stageUpdating} onClick={() => void reopenStage()}>重新打开阶段</button> : null}
          </div>
          {currentStatus === "in_progress" && stageGenerating ? <p className="stage-generation-note" id="stage-generation-note" role="status">本阶段有 Agent 正在生成；结束或停止后可完成。</p> : null}
          <div className="workbench-message-list" ref={messageList} aria-live="polite">
            {selectedDemo ? <div className="demo-warning">这是原型演示数据，不会保存到项目或迭代。</div> : null}
            {!activeSession && !selectedDemo ? <div className="stage-empty"><div><h3>从你想解决的问题开始。</h3><p>{currentInfo.hint}</p><button type="button" disabled={creatingSession || contextUpdating} onClick={() => void createSession()}>开始本阶段工作</button></div></div> : null}
            {activeSession && messagesLoading ? <p className="session-loading" role="status">正在打开会话…</p> : null}
            {activeSession && !messagesLoading && messages.length === 0 ? <div className="stage-empty session-start"><h3>这个会话还没有消息</h3><p>{currentInfo.hint}</p></div> : null}
            {(selectedDemo ? currentDemoMessages.map(([role, content], index): Message => ({ id: `demo-${index}`, role, content })) : messages).map((message) => <article className={`workbench-message ${message.role}`} key={message.id}>
              <div className="message-label">{message.role === "user" ? "你" : currentInfo.agent}{message.status === "generating" ? <span> · 生成中</span> : message.status === "failed" ? <span> · {message.errorMessage === "生成已停止" ? "已停止" : "生成失败"}</span> : null}</div>
              {editingId === message.id ? <div className="inline-message-edit"><textarea aria-label="修改这条消息" value={editValue} onChange={(event) => setEditValue(event.target.value)}/><div><button type="button" onClick={() => { setEditingId(null); setEditValue(""); }}>取消</button><button type="button" disabled={!editValue.trim() || sending || currentStatus === "completed"} onClick={() => void sendMessage(editValue, message.id)}>发送</button></div></div> : <><div className="message-content">{message.status === "failed" && !message.content ? message.errorMessage ?? "生成失败" : message.content}</div>{!selectedDemo && <div className="message-actions"><button type="button" title="复制消息" aria-label="复制消息" onClick={() => { void navigator.clipboard.writeText(message.content).then(() => showToast("已复制消息")).catch(() => showToast("复制失败，请手动选择文本")); }}><Icon name="copy"/></button>{message.role === "user" && message.id === lastUserId && <button type="button" title="修改并重新发送" aria-label="修改并重新发送" disabled={currentStatus === "completed" || sending} onClick={() => { setEditingId(message.id); setEditValue(message.content); }}><Icon name="edit"/></button>}{message.role === "assistant" && message.id === lastAssistantId && <button type="button" title="重新生成" aria-label="重新生成" disabled={sending || currentStatus === "completed" || message.status !== "completed"} onClick={() => void sendMessage("", undefined, message.id)}><Icon name="refresh"/></button>}</div>}</>}
            </article>)}
          </div>
          <form className="workbench-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(input); }}>
            <textarea value={input} onChange={(event) => { if (activeSessionId) setDrafts((previous) => ({ ...previous, [activeSessionId]: event.target.value })); }} disabled={!activeSession || sessionGenerating || currentStatus === "completed" || Boolean(selectedDemo) || messagesLoading} placeholder={selectedDemo ? "演示会话为只读" : currentStatus === "completed" ? "重新打开阶段后可继续讨论" : activeSession ? "写下你现在想讨论的问题或判断……" : "开始本阶段工作后即可发送消息"} aria-label="输入消息"/>
            <div>{sessionGenerating ? <button className="stop-generation-button" type="button" disabled={stoppingGeneration} onClick={() => void stopGeneration()}>{stoppingGeneration ? "正在停止…" : "停止生成"}</button> : null}<button type="submit" disabled={!activeSession || !input.trim() || sessionGenerating || currentStatus === "completed" || messagesLoading}>{sending ? "发送中…" : "发送消息"}</button></div>
          </form>
        </section>

        {contextOpen && <aside className="workbench-context" aria-label="项目文件与上下文" ref={contextPanel}>
          <div className="context-heading"><h2>文件与上下文</h2><button type="button" className="context-close" aria-label="关闭文件区" title="关闭文件区" onClick={() => setContextOpen(false)}><Icon name="close"/></button></div>
          <div className="context-switch" role="tablist" aria-label="文件视图"><button type="button" role="tab" aria-selected={contextTab === "tree"} onClick={() => setContextTab("tree")}>项目文件树 <span>{files.length}</span></button><button type="button" role="tab" aria-selected={contextTab === "context"} onClick={() => setContextTab("context")}>当前上下文 <span>{contextIds.length}</span></button></div>
          {contextTab === "tree" ? <div className="context-scroll">{groupedFiles.length ? groupedFiles.map(([branch, branchFiles]) => <details className="file-branch" key={branch} open><summary>{branch}<span>{branchFiles.length}</span></summary>{branchFiles.map((file) => <div className="project-file-row" key={file.id}><span title={file.filename}><Icon name="file"/>{file.filename}</span><button type="button" aria-label={`${contextIds.includes(file.id) ? "从" : "加入"}上下文：${file.filename}`} disabled={contextIds.includes(file.id) || messagesLoading || contextUpdating} onClick={() => void toggleContext(file.id, true)}>{contextIds.includes(file.id) ? "已加入" : "加入"}</button></div>)}</details>) : <p className="context-empty">项目文件树还是空的。</p>}</div> : <div className="context-scroll">{contextIds.length ? files.filter((file) => contextIds.includes(file.id)).map((file) => <div className="project-file-row loaded" key={file.id}><span title={file.filename}><Icon name="file"/>{file.filename}</span><button type="button" disabled={messagesLoading || contextUpdating} onClick={() => void toggleContext(file.id, false)} aria-label={`从当前上下文移除 ${file.filename}`}>移除</button></div>) : <p className="context-empty">当前会话没有加载文件。</p>}</div>}
        </aside>}
      </div>}
    </div>
    {toast && <div className="workbench-toast" role="status">{toast}</div>}
  </main>;
}
