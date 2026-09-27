"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface ProductIteration {
  id: string;
  project_id: string;
  display_name: string;
  iteration_number: number;
  goal: string | null;
  created_at: string;
  updated_at: string;
}

interface Project {
  id: string;
  name: string;
  created_at?: string;
}

interface ProductIterationListProps {
  projectId: string;
}

type DrawerMode = "create" | "edit";

function formatIterationNumber(value: number) {
  return `迭代 ${String(value).padStart(2, "0")}`;
}

function formatUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export default function ProductIterationList({ projectId }: ProductIterationListProps) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [iterations, setIterations] = useState<ProductIteration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawerMode, setDrawerMode] = useState<DrawerMode | null>(null);
  const [editingIteration, setEditingIteration] = useState<ProductIteration | null>(null);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [targetMode, setTargetMode] = useState<"fill" | "skip" | "">("");
  const [riskOpen, setRiskOpen] = useState(false);
  const [riskConfirmed, setRiskConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [iterationMenuId, setIterationMenuId] = useState<string | null>(null);
  const [deletingIteration, setDeletingIteration] = useState<ProductIteration | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const fetchIterations = useCallback(async () => {
    try {
      setError("");
      const response = await fetch(`/api/projects/${projectId}/iterations`);
      if (!response.ok) throw new Error(response.status === 404 ? "项目不存在或无权访问" : "获取产品迭代失败");
      setIterations(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取产品迭代失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern
    void fetchIterations();
    let cancelled = false;
    void fetch(`/api/projects/${projectId}`).then(async (response) => {
      if (response.ok && !cancelled) setProject(await response.json());
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [fetchIterations, projectId]);

  function openCreate() {
    setDrawerMode("create");
    setEditingIteration(null);
    setName("");
    setGoal("");
    setTargetMode("");
    setRiskConfirmed(false);
    setRiskOpen(false);
    setIterationMenuId(null);
    setFormError("");
  }

  function openEdit(iteration: ProductIteration) {
    setDrawerMode("edit");
    setEditingIteration(iteration);
    setName(iteration.display_name);
    setGoal(iteration.goal ?? "");
    setFormError("");
    setIterationMenuId(null);
  }

  function closeDrawer() {
    if (saving) return;
    setDrawerMode(null);
    setRiskOpen(false);
    setFormError("");
  }

  function chooseTargetMode(mode: "fill" | "skip") {
    setTargetMode(mode);
    if (mode === "skip" && !riskConfirmed) setRiskOpen(true);
  }

  async function submitCreate() {
    if (!name.trim()) {
      setFormError("请先填写展示名称。");
      return;
    }
    if (!targetMode) {
      setFormError("请选择填写本轮目标，或确认暂不填写。");
      return;
    }
    if (targetMode === "fill" && !goal.trim()) {
      setFormError("填写目标分支需要至少写下一句话。");
      return;
    }
    if (targetMode === "skip" && !riskConfirmed) {
      setRiskOpen(true);
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/iterations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name.trim(), goal: targetMode === "fill" ? goal.trim() : null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "创建产品迭代失败");
      setDrawerMode(null);
      setRiskOpen(false);
      setToast(`${formatIterationNumber(body.iteration_number)} 已创建，正在进入工作区。`);
      window.setTimeout(() => router.push(`/projects/${projectId}/iterations/${body.id}`), 220);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "创建产品迭代失败");
      setSaving(false);
    }
  }

  async function submitEdit() {
    if (!editingIteration || !name.trim()) {
      setFormError("展示名称不能为空。");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const response = await fetch(`/api/iterations/${editingIteration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name.trim(), goal: goal.trim() || null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "保存产品迭代失败");
      setIterations((current) => current.map((item) => item.id === body.id ? body : item));
      setDrawerMode(null);
      setToast("迭代信息已保存，稳定编号保持不变。");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存产品迭代失败");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteIteration() {
    if (!deletingIteration || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/iterations/${deletingIteration.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "删除产品迭代失败");
      setIterations((current) => current.filter((item) => item.id !== deletingIteration.id));
      setToast(`${formatIterationNumber(deletingIteration.iteration_number)} 已删除。项目文件和已确认内容未受影响。`);
      setDeletingIteration(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "删除产品迭代失败，请重试。");
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <section className="iteration-list-panel">
      <main className="iteration-main">
        <header className="iteration-project-head">
          <div>
            <p className="iteration-eyebrow">SELECTED PROJECT</p>
            <h2>{project?.name || "项目"}</h2>
            <div className="iteration-project-meta"><span>最近更新 {project?.created_at ? formatUpdated(project.created_at) : "刚刚"}</span></div>
          </div>
        </header>

        {loading ? <div className="iteration-state"><p>正在加载产品迭代...</p></div> : error && iterations.length === 0 ? <div className="iteration-state"><h3>加载失败</h3><p>{error}</p><button className="iteration-button iteration-button-primary" type="button" onClick={() => void fetchIterations()}>重试</button></div> : (
          <section className="iteration-list-section" aria-labelledby="iteration-list-title">
            <div className="iteration-section-head"><div><h3 id="iteration-list-title">产品迭代</h3><p>一个项目可以有多个迭代，稳定编号只增不减。</p></div><button className="iteration-button iteration-button-primary iteration-create-button" type="button" onClick={openCreate}>创建产品迭代</button></div>
            {error && <p className="iteration-error" role="alert">{error}</p>}
            {iterations.length === 0 ? <div className="iteration-empty"><p>这个项目还没有产品迭代。</p><button className="iteration-button iteration-button-primary" type="button" onClick={openCreate}>创建产品迭代</button></div> : <div className="iteration-table" role="list">{iterations.map((iteration) => { const menuOpen = iterationMenuId === iteration.id; return <article className="iteration-row" role="listitem" key={iteration.id}><span className="iteration-number">{formatIterationNumber(iteration.iteration_number)}</span><div className="iteration-name"><strong title={iteration.display_name}>{iteration.display_name}</strong></div><p className={`iteration-goal${iteration.goal ? "" : " empty"}`}>{iteration.goal || "尚未填写本轮目标"}</p><span className="iteration-updated">更新 · {formatUpdated(iteration.updated_at)}</span><div className="iteration-row-actions"><button className="iteration-button iteration-button-quiet" type="button" onClick={() => router.push(`/projects/${projectId}/iterations/${iteration.id}`)}>进入工作区</button><button className="iteration-button iteration-button-quiet" type="button" onClick={() => openEdit(iteration)}>编辑迭代</button><button className="iteration-more" type="button" aria-label={`${iteration.display_name} 更多功能`} aria-expanded={menuOpen} onClick={() => setIterationMenuId(menuOpen ? null : iteration.id)}>···</button>{menuOpen && <div className="iteration-menu"><button className="iteration-menu-action danger" type="button" onClick={() => { setIterationMenuId(null); setDeleteError(""); setDeletingIteration(iteration); }}>删除产品迭代</button></div>}</div></article>; })}</div>}
          </section>
        )}
      </main>

      {drawerMode && <div className="iteration-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}><aside className="iteration-drawer" role="dialog" aria-modal="true" aria-labelledby="iteration-drawer-title"><div className="iteration-drawer-head"><div><p className="iteration-eyebrow">ITERATION / {drawerMode === "create" ? "CREATE" : "EDIT"}</p><h2 id="iteration-drawer-title">{drawerMode === "create" ? "创建产品迭代" : "编辑产品迭代"}</h2></div><button className="iteration-close" type="button" aria-label="关闭面板" onClick={closeDrawer}>×</button></div>{drawerMode === "create" ? <p className="iteration-drawer-intro">给这一轮一个可读的名字，再明确你是否要提供本轮目标。两个选项都不会替你默认选择。</p> : <p className="iteration-drawer-intro">展示名称和本轮目标可以随时更新。稳定编号是这次迭代的长期身份，创建后不可修改。</p>}
          <form onSubmit={(event) => { event.preventDefault(); void (drawerMode === "create" ? submitCreate() : submitEdit()); }}><label className="iteration-field"><span>展示名称 <small>必填</small></span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="例如：降低首次使用流失" autoFocus /></label>{drawerMode === "edit" && editingIteration && <label className="iteration-field"><span>稳定编号</span><input value={formatIterationNumber(editingIteration.iteration_number)} disabled /></label>}{drawerMode === "create" ? <fieldset className="iteration-choice-group"><legend>本轮目标 <small>请选择一个</small></legend><label className={`iteration-choice ${targetMode === "fill" ? "selected" : ""}`} onClick={() => chooseTargetMode("fill")}><input type="radio" name="target-mode" value="fill" checked={targetMode === "fill"} onChange={() => chooseTargetMode("fill")} /><span className="iteration-choice-marker">A</span><span><strong>填写本轮目标</strong><em>让四个阶段的 Agent 知道这一轮要解决什么。</em></span></label><label className={`iteration-choice ${targetMode === "skip" ? "selected" : ""}`} onClick={() => chooseTargetMode("skip")}><input type="radio" name="target-mode" value="skip" checked={targetMode === "skip"} onChange={() => chooseTargetMode("skip")} /><span className="iteration-choice-marker">B</span><span><strong>暂不填写</strong><em>稍后仍可补充，但 Agent 不会替你猜测目标。</em></span></label></fieldset> : null}<label className={`iteration-field iteration-goal-field ${drawerMode === "create" && targetMode !== "fill" ? "iteration-field-hidden" : ""}`}><span>本轮目标 <small>{drawerMode === "create" ? "填写后可修改" : "可选"}</small></span><textarea value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={500} placeholder="这一轮最想改变什么？" /></label>{formError && <p className="iteration-form-error" role="alert">{formError}</p>}<div className="iteration-drawer-actions"><button className="iteration-button iteration-button-quiet" type="button" onClick={closeDrawer}>取消</button><button className="iteration-button iteration-button-primary" type="submit" disabled={saving}>{saving ? (drawerMode === "create" ? "创建中..." : "保存中...") : drawerMode === "create" ? "创建并进入工作区" : "保存修改"}</button></div></form>
        </aside></div>}

      {riskOpen && <div className="iteration-risk-overlay" role="presentation"><section className="iteration-risk-dialog" role="dialog" aria-modal="true" aria-labelledby="iteration-risk-title"><p className="iteration-eyebrow">DECISION CHECK / TARGET</p><h2 id="iteration-risk-title">暂不填写本轮目标？</h2><p>你可以继续，但请确认你了解这会给本轮工作带来的边界。</p><div className="iteration-risk-items"><div><strong>Agent 已知</strong><p>Agent 只会知道项目、迭代编号、你手动加载的文件，以及你在对话中提供的内容。</p></div><div><strong>Agent 未知</strong><p>它不会知道本轮要改变什么，也不会根据迭代名称或文件目录替你猜测。</p></div></div><p className="iteration-risk-footnote">确认后，本次创建不再重复警告。创建后回到迭代列表，你仍然可以补充或修改本轮目标。</p><div className="iteration-risk-actions"><button className="iteration-button iteration-button-quiet" type="button" onClick={() => setRiskOpen(false)}>返回重新选择</button><button className="iteration-button iteration-button-primary" type="button" onClick={() => { setRiskConfirmed(true); setRiskOpen(false); setToast("已记录选择。创建前仍可返回填写目标。"); }}>确认暂不填写</button></div></section></div>}
      {deletingIteration && <div className="iteration-risk-overlay" role="presentation"><section className="iteration-risk-dialog iteration-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="iteration-delete-title" aria-describedby="iteration-delete-copy"><p className="iteration-eyebrow">ITERATION / DELETE · {formatIterationNumber(deletingIteration.iteration_number)}</p><h2 id="iteration-delete-title">删除产品迭代？</h2><p id="iteration-delete-copy">删除后，这一轮的聊天记录和还没确认保存的内容会被删除，但已确认保存的内容及其变更记录会保留。你可以在文件树内把这些内容彻底删除。</p>{deleteError && <p className="iteration-form-error" role="alert">{deleteError}</p>}<div className="iteration-risk-actions"><button className="iteration-button iteration-button-quiet" type="button" disabled={deleting} onClick={() => setDeletingIteration(null)}>取消</button><button className="iteration-button iteration-button-danger" type="button" disabled={deleting} onClick={() => void confirmDeleteIteration()}>{deleting ? "删除中..." : "确认删除迭代"}</button></div></section></div>}
      {toast && <div className="iteration-toast" role="status" aria-live="polite">{toast}</div>}
    </section>
  );
}
