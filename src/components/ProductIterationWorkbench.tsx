"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getWorkbenchFileStage } from "@/lib/workbench-file-branch";

type StageKey = "analysis" | "prototype" | "prd" | "tickets";
type StageStatus = "not_started" | "in_progress" | "completed";
type Stage = { key: StageKey; status: StageStatus; sessions: Session[] };
type Session = { id: string; title: string; updatedAt?: string };
type Message = { id: string; role: "user" | "assistant"; content: string; status?: string; timestamp?: string };
type Project = { id: string; name: string };
type Iteration = { id: string; project_id: string; iteration_number: number; display_name: string; goal: string | null };
type FileRecord = { id: string; filename: string; version?: number; updated_at?: string };

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
  const [stages, setStages] = useState<Stage[]>(stageInfo.map(({ key }) => ({ key, status: "not_started", sessions: [] })));
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [contextIds, setContextIds] = useState<string[]>([]);
  const [contextTab, setContextTab] = useState<"tree" | "context">("tree");
  const [contextOpen, setContextOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ target: StageKey; missing: StageKey } | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [demoId, setDemoId] = useState<string | null>(null);
  const [demoExpanded, setDemoExpanded] = useState(true);
  const [toast, setToast] = useState("");
  const messageList = useRef<HTMLDivElement>(null);
  const contextPanel = useRef<HTMLElement>(null);
  const loadSequence = useRef(0);

  const currentInfo = stageInfo.find((stage) => stage.key === currentStage) ?? stageInfo[0];
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const selectedDemo = demoSessions.find((session) => session.id === demoId) ?? null;

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
      setActiveSessionId(activeState?.sessions?.[0]?.id ?? null);
      setDemoId(null);
      setMessages([]);
      setContextIds([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "工作台加载失败。");
    } finally {
      setLoading(false);
    }
  }, [base, project.id, request]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadWorkbench(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkbench]);

  const loadMessages = useCallback(async (sessionId: string | null) => {
    const requestSequence = ++loadSequence.current;
    setMessages([]);
    setContextIds([]);
    setEditingId(null);
    if (!sessionId) return;
    try {
      const [history, context] = await Promise.all([
        request(`${base}/stages/${currentStage}/sessions/${sessionId}/messages`),
        request(`${base}/stages/${currentStage}/sessions/${sessionId}/context`),
      ]);
      if (requestSequence !== loadSequence.current) return;
      setMessages(history.messages);
      setContextIds(context.fileIds);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "会话内容加载失败。");
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
    setCurrentStage(key);
    setDemoId(null);
    const stage = stages.find((entry) => entry.key === key);
    const nextSessions = stage?.sessions ?? [];
    setSessions(nextSessions);
    setActiveSessionId(nextSessions[0]?.id ?? null);
    try {
      await request(`${base}/workbench`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: key }) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "阶段位置保存失败。"); }
  }

  async function createSession() {
    try {
      const result = await request(`${base}/stages/${currentStage}/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const session = result.session as Session;
      const next = [...sessions, session];
      setSessions(next);
      setStages((previous) => previous.map((stage) => stage.key === currentStage ? { ...stage, status: "in_progress", sessions: next } : stage));
      setActiveSessionId(session.id);
      setDemoId(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "创建会话失败。"); }
  }

  async function chooseSession(session: Session) {
    loadSequence.current += 1;
    setDemoId(null);
    setActiveSessionId(session.id);
  }

  async function sendMessage(content: string, editMessageId?: string, regenerateMessageId?: string) {
    if (!activeSessionId || (!content.trim() && !regenerateMessageId) || sending) return;
    setSending(true);
    setError("");
    try {
      if (editMessageId) {
        await request(`${base}/sessions/${activeSessionId}/messages/${editMessageId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: content.trim() }),
        });
        const history = await request(`${base}/stages/${currentStage}/sessions/${activeSessionId}/messages`);
        setMessages(history.messages);
      } else {
        const result = await request(`${base}/stages/${currentStage}/sessions/${activeSessionId}/messages`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...(content.trim() ? { content: content.trim() } : {}), ...(regenerateMessageId ? { regenerateMessageId } : {}) }),
        });
        setMessages(result.messages);
      }
      setInput(""); setEditingId(null); setEditValue("");
      const now = new Date().toISOString();
      setSessions((previous) => previous.map((session) => session.id === activeSessionId ? { ...session, updatedAt: now } : session));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "消息发送失败。"); }
    finally { setSending(false); }
  }

  async function toggleContext(fileId: string, add: boolean) {
    if (!activeSessionId) { showToast("请先开始本阶段工作。"); return; }
    try {
      const result = await request(`${base}/stages/${currentStage}/sessions/${activeSessionId}/context`, {
        method: add ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId }),
      });
      setContextIds(result.fileIds);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "上下文更新失败。"); }
  }

  function selectDemo(id: string) {
    loadSequence.current += 1;
    setActiveSessionId(null);
    setDemoId(id);
    setMessages([]);
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
          {stageInfo.map((stage, index) => <button key={stage.key} className="workbench-stage" type="button" aria-current={currentStage === stage.key ? "step" : undefined} onClick={() => void enterStage(stage.key)}>
            <span className="stage-index">{String(index + 1).padStart(2, "0")}</span><span className="stage-title">{stage.label}</span><span className="stage-status">{statusLabel(stages.find((item) => item.key === stage.key)?.status)}</span>
          </button>)}
        </nav>
        {notice && <div className="workbench-notice" role="status"><div><strong>还没有确认的{stageInfo.find((stage) => stage.key === notice.missing)?.label}成果</strong><p>直接进入{stageInfo.find((stage) => stage.key === notice.target)?.label}，可能会缺少前置依据。你仍可以继续。</p></div><div className="notice-actions"><button type="button" onClick={() => void enterStage(notice.missing, true)}>返回{stageInfo.find((stage) => stage.key === notice.missing)?.label}</button><button className="notice-continue" type="button" onClick={() => void enterStage(notice.target, true)}>继续进入{stageInfo.find((stage) => stage.key === notice.target)?.label}</button></div></div>}
      </section>

      {error && <div className="workbench-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>关闭</button></div>}
      {loading ? <div className="workbench-loading" aria-label="正在加载工作台"><span/><span/><span/></div> : <div className={`workbench-grid ${contextOpen ? "" : "context-collapsed"}`}>
        <aside className="workbench-sessions" aria-label="阶段会话">
          <div className="sessions-heading"><h2>阶段会话</h2><button className="new-session-button" type="button" onClick={() => void createSession()} aria-label="新建会话" title="新建会话"><Icon name="plus"/></button></div>
          {sessions.length ? <div className="real-session-list">{sessions.map((session) => <button key={session.id} className="session-row" type="button" aria-current={activeSessionId === session.id ? "page" : undefined} onClick={() => void chooseSession(session)}><strong>{session.title}</strong><small>{session.updatedAt ? new Date(session.updatedAt).toLocaleDateString("zh-CN") : "尚无消息"}</small></button>)}</div> : <p className="session-empty">本阶段还没有会话</p>}
          {currentStage === "analysis" ? <details className="demo-section" open={demoExpanded} onToggle={(event) => setDemoExpanded(event.currentTarget.open)}><summary className="demo-divider"><span>演示会话</span><small>不属于你的项目</small></summary>
          <div className="demo-session-list">{demoSessions.map((session) => <button key={session.id} type="button" className="demo-session" aria-current={demoId === session.id ? "page" : undefined} onClick={() => selectDemo(session.id)}><strong>{session.title}</strong><small>{session.messages.length} 条示例消息</small></button>)}</div></details> : null}
        </aside>

        <section className="workbench-conversation" aria-labelledby="conversation-title">
          <div className="conversation-heading"><h2 id="conversation-title">{activeSession?.title ?? selectedDemo?.title ?? currentInfo.label}</h2></div>
          <div className="workbench-message-list" ref={messageList} aria-live="polite">
            {selectedDemo ? <div className="demo-warning">这是原型演示数据，不会保存到项目或迭代。</div> : null}
            {!activeSession && !selectedDemo ? <div className="stage-empty"><div><h3>从你想解决的问题开始。</h3><p>{currentInfo.hint}</p><button type="button" onClick={() => void createSession()}>开始本阶段工作</button></div></div> : null}
            {(selectedDemo ? currentDemoMessages.map(([role, content], index): Message => ({ id: `demo-${index}`, role, content })) : messages).map((message) => <article className={`workbench-message ${message.role}`} key={message.id}>
              <div className="message-label">{message.role === "user" ? "你" : currentInfo.agent}{message.status && message.status !== "completed" ? <span> · {message.status}</span> : null}</div>
              {editingId === message.id ? <div className="inline-message-edit"><textarea aria-label="修改这条消息" value={editValue} onChange={(event) => setEditValue(event.target.value)}/><div><button type="button" onClick={() => { setEditingId(null); setEditValue(""); }}>取消</button><button type="button" disabled={!editValue.trim() || sending} onClick={() => void sendMessage(editValue, message.id)}>发送</button></div></div> : <><div className="message-content">{message.content}</div>{!selectedDemo && <div className="message-actions"><button type="button" title="复制消息" aria-label="复制消息" onClick={() => { void navigator.clipboard.writeText(message.content).then(() => showToast("已复制消息")).catch(() => showToast("复制失败，请手动选择文本")); }}><Icon name="copy"/></button>{message.role === "user" && message.id === lastUserId && <button type="button" title="修改并重新发送" aria-label="修改并重新发送" onClick={() => { setEditingId(message.id); setEditValue(message.content); }}><Icon name="edit"/></button>}{message.role === "assistant" && message.id === lastAssistantId && <button type="button" title="重新生成" aria-label="重新生成" disabled={sending || message.status !== "completed"} onClick={() => void sendMessage("", undefined, message.id)}><Icon name="refresh"/></button>}</div>}</>}
            </article>)}
          </div>
          <form className="workbench-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(input); }}>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} disabled={!activeSession || sending || Boolean(selectedDemo)} placeholder={selectedDemo ? "演示会话为只读" : activeSession ? "写下你现在想讨论的问题或判断……" : "开始本阶段工作后即可发送消息"} aria-label="输入消息"/>
            <div><button type="submit" disabled={!activeSession || !input.trim() || sending}>{sending ? "发送中…" : "发送消息"}</button></div>
          </form>
        </section>

        {contextOpen && <aside className="workbench-context" aria-label="项目文件与上下文" ref={contextPanel}>
          <div className="context-heading"><h2>文件与上下文</h2><button type="button" className="context-close" aria-label="关闭文件区" title="关闭文件区" onClick={() => setContextOpen(false)}><Icon name="close"/></button></div>
          <div className="context-switch" role="tablist" aria-label="文件视图"><button type="button" role="tab" aria-selected={contextTab === "tree"} onClick={() => setContextTab("tree")}>项目文件树 <span>{files.length}</span></button><button type="button" role="tab" aria-selected={contextTab === "context"} onClick={() => setContextTab("context")}>当前上下文 <span>{contextIds.length}</span></button></div>
          {contextTab === "tree" ? <div className="context-scroll">{groupedFiles.length ? groupedFiles.map(([branch, branchFiles]) => <details className="file-branch" key={branch} open><summary>{branch}<span>{branchFiles.length}</span></summary>{branchFiles.map((file) => <div className="project-file-row" key={file.id}><span title={file.filename}><Icon name="file"/>{file.filename}</span><button type="button" aria-label={`${contextIds.includes(file.id) ? "从" : "加入"}上下文：${file.filename}`} disabled={contextIds.includes(file.id)} onClick={() => void toggleContext(file.id, true)}>{contextIds.includes(file.id) ? "已加入" : "加入"}</button></div>)}</details>) : <p className="context-empty">项目文件树还是空的。</p>}</div> : <div className="context-scroll">{contextIds.length ? files.filter((file) => contextIds.includes(file.id)).map((file) => <div className="project-file-row loaded" key={file.id}><span title={file.filename}><Icon name="file"/>{file.filename}</span><button type="button" onClick={() => void toggleContext(file.id, false)} aria-label={`从当前上下文移除 ${file.filename}`}>移除</button></div>) : <p className="context-empty">当前会话没有加载文件。</p>}</div>}
        </aside>}
      </div>}
    </div>
    {toast && <div className="workbench-toast" role="status">{toast}</div>}
  </main>;
}
