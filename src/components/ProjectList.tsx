"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Project {
  id: string;
  name: string;
  created_at: string;
}

export default function ProjectList() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setError("");
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("获取项目列表失败");
      const data = await res.json();
      setProjects(data);
    } catch {
      setError("获取项目列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern
    fetchProjects();
  }, [fetchProjects]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建失败");
      }
      setNewName("");
      setShowCreate(false);
      await fetchProjects();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建项目失败");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("确定要删除该项目及其所有工作记录吗？")) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "删除失败");
      }
      setProjects((prev) => prev.filter((p) => p.id !== id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除项目失败");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      ) : error && projects.length === 0 ? (
        /* Error state (only when no stale data to show) */
        <div className="flex flex-1 items-center justify-center py-20">
          <div className="text-center">
            <div className="mb-4 text-5xl">⚠️</div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900">
              加载失败
            </h2>
            <p className="mb-6 text-sm text-gray-500">{error}</p>
            <button
              onClick={fetchProjects}
              className="inline-block rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
            >
              重试
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-gray-900">我的项目</h1>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
            >
              {showCreate ? "取消" : "新建项目"}
            </button>
          </div>

          {/* Error banner (shown above content when stale data exists) */}
          {error && (
            <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
              <button
                onClick={() => setError("")}
                className="ml-2 underline underline-offset-2"
              >
                关闭
              </button>
            </div>
          )}

          {/* Create form */}
          {showCreate && (
            <form
              onSubmit={handleCreate}
              className="mb-6 rounded-lg border border-gray-200 bg-white p-4"
            >
              <label className="mb-2 block text-sm font-medium text-gray-700">
                项目名称
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="输入项目名称"
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {creating ? "创建中..." : "创建"}
                </button>
              </div>
            </form>
          )}

          {/* Empty state */}
          {!error && projects.length === 0 && !showCreate && (
            <div className="flex flex-1 items-center justify-center py-20">
              <div className="text-center">
                <div className="mb-4 text-5xl">📋</div>
                <h2 className="mb-2 text-xl font-semibold text-gray-900">
                  还没有项目
                </h2>
                <p className="mb-6 text-sm text-gray-500">
                  创建你的第一个项目，开始用 AI 驱动产品工作流
                </p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="inline-block rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
                >
                  创建第一个项目
                </button>
              </div>
            </div>
          )}

          {/* Project list */}
          {projects.length > 0 && (
            <ul className="space-y-2">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors"
                >
                  <Link
                    href={`/projects/${project.id}`}
                    className="flex-1 min-w-0"
                  >
                    <span className="font-medium text-gray-900 hover:text-gray-700 transition-colors">
                      {project.name}
                    </span>
                    <span className="ml-3 text-xs text-gray-400">
                      {new Date(project.created_at).toLocaleDateString("zh-CN")}
                    </span>
                  </Link>
                  <button
                    onClick={() => handleDelete(project.id)}
                    disabled={deletingId === project.id}
                    className="ml-4 rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
                  >
                    {deletingId === project.id ? "删除中..." : "删除"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
