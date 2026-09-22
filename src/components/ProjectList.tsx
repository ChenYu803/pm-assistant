"use client";

import { useCallback, useEffect, useState } from "react";
import ProductIterationList from "@/components/ProductIterationList";

interface Project { id: string; name: string; created_at: string; }

export default function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      setError("");
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("获取项目列表失败");
      const nextProjects = (await response.json()) as Project[];
      setProjects(nextProjects);
      setSelectedId((current) => current && nextProjects.some((project) => project.id === current) ? current : nextProjects[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取项目列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern
    void fetchProjects();
  }, [fetchProjects]);

  function openCreate() { setActiveProject(null); setName(""); setDialog("create"); }
  function openProjectDialog(kind: "rename" | "delete", project: Project) { setActiveProject(project); setName(project.name); setDialog(kind); }
  function closeDialog() { if (!saving) setDialog(null); }

  async function saveProject() {
    if (!name.trim()) { setError("项目名称不能为空"); return; }
    setSaving(true);
    try {
      const response = await fetch(activeProject ? `/api/projects/${activeProject.id}` : "/api/projects", {
        method: activeProject ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "保存项目失败");
      if (activeProject) {
        setProjects((current) => current.map((project) => project.id === activeProject.id ? { ...project, name: body.name } : project));
      } else {
        setProjects((current) => [body, ...current]);
        setSelectedId(body.id);
      }
      setDialog(null);
    } catch (err) { setError(err instanceof Error ? err.message : "保存项目失败"); }
    finally { setSaving(false); }
  }

  async function deleteProject() {
    if (!activeProject) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${activeProject.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "删除项目失败");
      const nextProjects = projects.filter((project) => project.id !== activeProject.id);
      setProjects(nextProjects); setSelectedId(nextProjects[0]?.id ?? null); setDialog(null);
    } catch (err) { setError(err instanceof Error ? err.message : "删除项目失败"); }
    finally { setSaving(false); }
  }

  const selectedProject = projects.find((project) => project.id === selectedId);

  return (
    <div className="project-workspace-shell">
      <aside className="project-workspace-rail" aria-label="我的项目">
        <a className="project-workspace-brand" href="#top"><span className="project-workspace-mark">A</span><span>AI 产品现场</span></a>
        <div className="project-workspace-heading"><p className="project-workspace-eyebrow">PROJECTS / WORKSPACE</p><h1>我的项目</h1><p>选择一个项目，管理它的产品迭代。</p></div>
        <button className="project-workspace-create" type="button" onClick={openCreate}>新建一个项目</button>
        {error && <p className="project-workspace-error" role="alert">{error}</p>}
        <div className="project-workspace-list" role="list" aria-label="项目列表">
          {projects.map((project) => <div className={`project-workspace-item${selectedId === project.id ? " selected" : ""}`} role="listitem" key={project.id}>
            <button className="project-workspace-select" type="button" onClick={() => setSelectedId(project.id)}><strong>{project.name}</strong><span>{new Date(project.created_at).toLocaleDateString("zh-CN")}</span></button>
            <button className="project-workspace-more" type="button" aria-label={`${project.name} 项目操作`} onClick={() => openProjectDialog("rename", project)}>···</button>
          </div>)}
        </div>
      </aside>
      <main className="project-workspace-main" id="top">
        {loading ? <section className="project-workspace-empty"><p>正在加载项目...</p></section> : selectedProject ? <ProductIterationList projectId={selectedProject.id} embedded /> : <section className="project-workspace-empty"><h2>让我们<br className="project-workspace-mobile-break" />开始工作</h2><p>先创建一个项目，或从左侧选择已有项目。</p><button className="project-workspace-create project-workspace-create-main" type="button" onClick={openCreate}>新建一个项目</button></section>}
      </main>

      {dialog && <div className="project-workspace-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}><section className="project-workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
        <p className="project-workspace-eyebrow">PROJECT / {dialog.toUpperCase()}</p>
        <h2 id="project-dialog-title">{dialog === "create" ? "新建一个项目" : dialog === "rename" ? "重命名项目" : "删除项目？"}</h2>
        {dialog === "delete" ? <><p>删除“{activeProject?.name}”后，该项目下的产品迭代、聊天记录和项目文件都会被永久删除，且无法恢复。</p><div className="project-workspace-dialog-actions"><button type="button" onClick={closeDialog}>取消</button><button className="danger" type="button" onClick={() => void deleteProject()} disabled={saving}>{saving ? "删除中..." : "确认删除项目"}</button></div></> : <><label><span>项目名称</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus placeholder="例如：小红书新用户体验" /></label><div className="project-workspace-dialog-actions"><button type="button" onClick={closeDialog}>取消</button>{dialog === "rename" && <button className="danger" type="button" onClick={() => setDialog("delete")}>删除项目</button>}<button className="primary" type="button" onClick={() => void saveProject()} disabled={saving}>{saving ? "保存中..." : dialog === "create" ? "创建项目" : "保存名称"}</button></div></>}
      </section></div>}
    </div>
  );
}
