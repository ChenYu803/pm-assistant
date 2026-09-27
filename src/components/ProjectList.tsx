"use client";

import { useCallback, useEffect, useState } from "react";
import ProductIterationList from "@/components/ProductIterationList";

interface Project {
  id: string;
  name: string;
  created_at: string;
}

type DialogMode = "create" | "description" | "rename" | "delete";

function projectDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export default function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [iterationCounts, setIterationCounts] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogMode | null>(null);
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
      const counts = await Promise.all(nextProjects.map(async (project) => {
        try {
          const iterationsResponse = await fetch(`/api/projects/${project.id}/iterations`);
          if (!iterationsResponse.ok) return [project.id, 0] as const;
          const iterations = await iterationsResponse.json() as unknown[];
          return [project.id, iterations.length] as const;
        } catch {
          return [project.id, 0] as const;
        }
      }));
      setIterationCounts(Object.fromEntries(counts));
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

  function openCreate() {
    setActiveProject(null);
    setName("");
    setMenuProjectId(null);
    setDialog("create");
  }

  function openProjectDialog(kind: Exclude<DialogMode, "create">, project: Project) {
    setActiveProject(project);
    setName(project.name);
    setMenuProjectId(null);
    setDialog(kind);
  }

  function closeDialog() {
    if (!saving) setDialog(null);
  }

  async function saveProject() {
    if (!name.trim()) {
      setError("项目名称不能为空");
      return;
    }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存项目失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProject() {
    if (!activeProject) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${activeProject.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "删除项目失败");
      const nextProjects = projects.filter((project) => project.id !== activeProject.id);
      setProjects(nextProjects);
      setSelectedId(nextProjects[0]?.id ?? null);
      setDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除项目失败");
    } finally {
      setSaving(false);
    }
  }

  const selectedProject = projects.find((project) => project.id === selectedId);
  const dialogTitle = dialog === "create" ? "新建一个项目" : dialog === "description" ? "项目描述" : dialog === "rename" ? "重命名项目" : "删除项目？";

  return (
    <div className="project-workspace-app">
      <div className="project-workspace-shell">
        <aside className="project-workspace-rail" aria-label="我的项目">
          <a className="project-workspace-brand" href="#top"><span className="project-workspace-mark">A</span><span>AI 产品现场</span></a>
          <div className="project-workspace-heading"><p className="project-workspace-eyebrow">PROJECTS / WORKSPACE</p><h1>我的项目</h1><p>选择一个项目，管理它的产品迭代。</p></div>
          <button className="project-workspace-create" type="button" onClick={openCreate}>新建一个项目</button>
          {error && <p className="project-workspace-error" role="alert">{error}</p>}
          <div className="project-workspace-list" role="list" aria-label="项目列表">
            {projects.map((project) => {
              const menuOpen = menuProjectId === project.id;
              return <div className={`project-workspace-item${selectedId === project.id ? " selected" : ""}`} role="listitem" key={project.id}>
                <button className="project-workspace-select" type="button" onClick={() => { setSelectedId(project.id); setMenuProjectId(null); }}><strong title={project.name}>{project.name}</strong></button>
                <button className="project-workspace-more" type="button" aria-label={`${project.name} 更多功能`} aria-expanded={menuOpen} onClick={() => setMenuProjectId(menuOpen ? null : project.id)}>···</button>
                {menuOpen && <div className="project-workspace-menu"><div className="project-workspace-menu-meta">最近更新时间 · {projectDate(project.created_at)}<br />产品迭代数量 · {iterationCounts[project.id] ?? 0} 个</div><button className="project-workspace-menu-action" type="button" onClick={() => openProjectDialog("description", project)}>查看项目描述</button><button className="project-workspace-menu-action" type="button" onClick={() => openProjectDialog("rename", project)}>重命名</button><button className="project-workspace-menu-action danger" type="button" onClick={() => openProjectDialog("delete", project)}>删除项目</button></div>}
              </div>;
            })}
          </div>
        </aside>
        <main className="project-workspace-main" id="top">
          {loading ? <section className="project-workspace-empty"><p>正在加载项目...</p></section> : selectedProject ? <ProductIterationList key={selectedProject.id} projectId={selectedProject.id} /> : <section className="project-workspace-empty"><h2>让我们<span className="project-workspace-mobile-break"><br /></span>开始工作</h2><p>先创建一个项目，或从左侧选择已有项目。</p><button className="project-workspace-create project-workspace-create-main" type="button" onClick={openCreate}>新建一个项目</button></section>}
        </main>
      </div>

      {dialog && <div className="project-workspace-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}><section className="project-workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title"><p className="project-workspace-eyebrow">PROJECT / {dialog.toUpperCase()}</p><h2 id="project-dialog-title">{dialogTitle}</h2>{dialog === "description" ? <><p>这个项目的长期说明暂未单独保存。产品迭代和项目文件都会归属于「{activeProject?.name}」。</p><div className="project-workspace-dialog-actions"><button className="primary" type="button" onClick={closeDialog}>知道了</button></div></> : dialog === "delete" ? <><p>删除“{activeProject?.name}”后，该项目下的产品迭代、聊天记录和项目文件都会被永久删除，且无法恢复。</p><div className="project-workspace-dialog-actions"><button type="button" onClick={closeDialog}>取消</button><button className="danger" type="button" onClick={() => void deleteProject()} disabled={saving}>{saving ? "删除中..." : "确认删除项目"}</button></div></> : <><label><span>项目名称</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus placeholder="例如：小红书新用户体验" /></label><div className="project-workspace-dialog-actions"><button type="button" onClick={closeDialog}>取消</button>{dialog === "rename" && <button className="danger" type="button" onClick={() => setDialog("delete")}>删除项目</button>}<button className="primary" type="button" onClick={() => void saveProject()} disabled={saving}>{saving ? "保存中..." : dialog === "create" ? "创建项目" : "保存名称"}</button></div></>}</section></div>}
    </div>
  );
}
