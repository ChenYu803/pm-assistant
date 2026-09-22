"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
}

interface ProductIterationListProps {
  projectId: string;
  embedded?: boolean;
}

type DrawerMode = "create" | "edit";

function formatIterationNumber(value: number) {
  return `迭代 ${String(value).padStart(2, "0")}`;
}

export default function ProductIterationList({ projectId, embedded = false }: ProductIterationListProps) {
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
    setFormError("");
  }

  function openEdit(iteration: ProductIteration) {
    setDrawerMode("edit");
    setEditingIteration(iteration);
    setName(iteration.display_name);
    setGoal(iteration.goal ?? "");
    setFormError("");
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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div className={`iteration-page${embedded ? " iteration-embedded" : ""}`}>
      <aside className="iteration-rail" aria-label="项目导航">
        <Link className="iteration-brand" href="/projects"><span className="iteration-brand-mark">A</span><span>AI 产品现场</span></Link>
        <div className="iteration-rail-heading"><p className="iteration-eyebrow">PROJECT / ITERATIONS</p><h1>产品迭代</h1><p>在同一个项目里，组织每一轮要改变的事情。</p></div>
        <Link className="iteration-back" href="/projects">← 返回我的项目</Link>
      </aside>

      <main className="iteration-main">
        <header className="iteration-project-head">
          <div>
            <p className="iteration-eyebrow">SELECTED PROJECT</p>
            <h2>{project?.name || "项目"}</h2>
            <p className="iteration-project-note">项目文件属于这里的长期资产；产品迭代只组织本轮工作。</p>
          </div>
          <button className="iteration-button iteration-button-primary" type="button" onClick={openCreate}>创建产品迭代</button>
        </header>

        {loading ? <div className="iteration-state"><p>正在加载产品迭代...</p></div> : error && iterations.length === 0 ? <div className="iteration-state"><h3>加载失败</h3><p>{error}</p><button className="iteration-button iteration-button-primary" type="button" onClick={() => void fetchIterations()}>重试</button></div> : (
          <section className="iteration-list-section" aria-labelledby="iteration-list-title">
            <div className="iteration-section-head"><div><p className="iteration-eyebrow">WORK CYCLES</p><h3 id="iteration-list-title">这一项目的产品迭代</h3><p>稳定编号只增不减，展示名称和本轮目标可以随时更新。</p></div><span className="iteration-count">{iterations.length} 个迭代</span></div>
            {error && <p className="iteration-error" role="alert">{error}</p>}
            {iterations.length === 0 ? <div className="iteration-empty"><span className="iteration-empty-index">01</span><div><h3>还没有产品迭代</h3><p>创建第一轮工作，明确这一次最想改变什么。</p></div><button className="iteration-button iteration-button-primary" type="button" onClick={openCreate}>创建产品迭代</button></div> : <div className="iteration-table" role="list">{iterations.map((iteration) => <article className="iteration-row" role="listitem" key={iteration.id}><span className="iteration-number">{formatIterationNumber(iteration.iteration_number)}</span><div className="iteration-row-content"><h4>{iteration.display_name}</h4><p className={iteration.goal ? "" : "iteration-goal-empty"}>{iteration.goal || "尚未填写本轮目标"}</p></div><span className="iteration-status">未开始</span><div className="iteration-row-actions"><button className="iteration-button iteration-button-quiet" type="button" onClick={() => openEdit(iteration)}>编辑迭代</button><button className="iteration-button iteration-button-dark" type="button" onClick={() => router.push(`/projects/${projectId}/iterations/${iteration.id}`)}>进入工作区</button></div></article>)}</div>}
          </section>
        )}
      </main>

      {drawerMode && <div className="iteration-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}><aside className="iteration-drawer" role="dialog" aria-modal="true" aria-labelledby="iteration-drawer-title"><div className="iteration-drawer-head"><div><p className="iteration-eyebrow">ITERATION / {drawerMode === "create" ? "CREATE" : "EDIT"}</p><h2 id="iteration-drawer-title">{drawerMode === "create" ? "创建产品迭代" : "编辑产品迭代"}</h2></div><button className="iteration-close" type="button" aria-label="关闭面板" onClick={closeDrawer}>×</button></div>{drawerMode === "create" ? <p className="iteration-drawer-intro">给这一轮一个可读的名字，再明确你是否要提供本轮目标。两个选项都不会替你默认选择。</p> : <p className="iteration-drawer-intro">展示名称和本轮目标可以随时更新。稳定编号是这次迭代的长期身份，创建后不可修改。</p>}
          <form onSubmit={(event) => { event.preventDefault(); void (drawerMode === "create" ? submitCreate() : submitEdit()); }}><label className="iteration-field"><span>展示名称 <small>必填</small></span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="例如：降低首次使用流失" autoFocus /></label>{drawerMode === "edit" && editingIteration && <label className="iteration-field"><span>稳定编号</span><input value={formatIterationNumber(editingIteration.iteration_number)} disabled /></label>}{drawerMode === "create" ? <fieldset className="iteration-choice-group"><legend>本轮目标 <small>请选择一个</small></legend><label className={`iteration-choice ${targetMode === "fill" ? "selected" : ""}`} onClick={() => chooseTargetMode("fill")}><input type="radio" name="target-mode" value="fill" checked={targetMode === "fill"} onChange={() => chooseTargetMode("fill")} /><span className="iteration-choice-marker">A</span><span><strong>填写本轮目标</strong><em>让四个阶段的 Agent 知道这一轮要解决什么。</em></span></label><label className={`iteration-choice ${targetMode === "skip" ? "selected" : ""}`} onClick={() => chooseTargetMode("skip")}><input type="radio" name="target-mode" value="skip" checked={targetMode === "skip"} onChange={() => chooseTargetMode("skip")} /><span className="iteration-choice-marker">B</span><span><strong>暂不填写</strong><em>稍后仍可补充，但 Agent 不会替你猜测目标。</em></span></label></fieldset> : null}<label className={`iteration-field iteration-goal-field ${drawerMode === "create" && targetMode !== "fill" ? "iteration-field-hidden" : ""}`}><span>本轮目标 <small>{drawerMode === "create" ? "填写后可修改" : "可选"}</small></span><textarea value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={500} placeholder="这一轮最想改变什么？" /></label>{formError && <p className="iteration-form-error" role="alert">{formError}</p>}<div className="iteration-drawer-actions"><button className="iteration-button iteration-button-quiet" type="button" onClick={closeDrawer}>取消</button><button className="iteration-button iteration-button-primary" type="submit" disabled={saving}>{saving ? (drawerMode === "create" ? "创建中..." : "保存中...") : drawerMode === "create" ? "创建并进入工作区" : "保存修改"}</button></div></form>
        </aside></div>}

      {riskOpen && <div className="iteration-risk-overlay" role="presentation"><section className="iteration-risk-dialog" role="dialog" aria-modal="true" aria-labelledby="iteration-risk-title"><p className="iteration-eyebrow">DECISION CHECK / TARGET</p><h2 id="iteration-risk-title">暂不填写本轮目标？</h2><p>你可以继续，但请确认你了解这会给本轮工作带来的边界。</p><div className="iteration-risk-items"><div><strong>Agent 已知</strong><p>Agent 只会知道项目、迭代编号、你手动加载的文件，以及你在对话中提供的内容。</p></div><div><strong>Agent 未知</strong><p>它不会知道本轮要改变什么，也不会根据迭代名称或文件目录替你猜测。</p></div></div><p className="iteration-risk-footnote">确认后，本次创建不再重复警告。创建后回到迭代列表，你仍然可以补充或修改本轮目标。</p><div className="iteration-risk-actions"><button className="iteration-button iteration-button-quiet" type="button" onClick={() => setRiskOpen(false)}>返回重新选择</button><button className="iteration-button iteration-button-primary" type="button" onClick={() => { setRiskConfirmed(true); setRiskOpen(false); setToast("已记录选择。创建前仍可返回填写目标。"); }}>确认暂不填写</button></div></section></div>}
      {toast && <div className="iteration-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}
