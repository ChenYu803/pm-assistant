"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface WorkRecord {
  id: string;
  name: string;
  project_id: string;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
}

interface WorkRecordListProps {
  projectId: string;
}

export default function WorkRecordList({ projectId }: WorkRecordListProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    try {
      setError("");
      const res = await fetch(`/api/projects/${projectId}/work-records`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("项目不存在");
        throw new Error("获取工作记录失败");
      }
      const data = await res.json();
      setRecords(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取工作记录失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern
    fetchRecords();
  }, [fetchRecords]);

  // Also fetch project name for breadcrumb
  useEffect(() => {
    let cancelled = false;
    async function fetchProject() {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setProject(data);
        }
      } catch {
        // Silently fail — project name is non-critical
      }
    }
    fetchProject();
    return () => { cancelled = true; };
  }, [projectId]);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/work-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建失败");
      }
      setShowCreate(false);
      await fetchRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建工作记录失败");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("确定要删除该工作记录吗？")) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/work-records/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "删除失败");
      }
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除工作记录失败");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-gray-500">
        <Link
          href="/projects"
          className="hover:text-gray-900 underline underline-offset-2 transition-colors"
        >
          项目列表
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900 font-medium">
          {project?.name || "项目"}
        </span>
      </nav>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      ) : error && records.length === 0 ? (
        /* Error state (only when no stale data to show) */
        <div className="flex flex-1 items-center justify-center py-20">
          <div className="text-center">
            <div className="mb-4 text-5xl">⚠️</div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900">
              加载失败
            </h2>
            <p className="mb-6 text-sm text-gray-500">{error}</p>
            <button
              onClick={fetchRecords}
              className="inline-block rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
            >
              重试
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-gray-900">工作记录</h1>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
            >
              {showCreate ? "取消" : "新建工作记录"}
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

          {/* Create confirmation */}
          {showCreate && (
            <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
              <p className="mb-3 text-sm text-gray-600">
                工作记录的名称将在首次对话后由 AI 自动生成。现在创建将显示为「未命名」。
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {creating ? "创建中..." : "确认创建"}
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!error && records.length === 0 && !showCreate && (
            <div className="flex flex-1 items-center justify-center py-20">
              <div className="text-center">
                <div className="mb-4 text-5xl">📝</div>
                <h2 className="mb-2 text-xl font-semibold text-gray-900">
                  还没有工作记录
                </h2>
                <p className="mb-6 text-sm text-gray-500">
                  创建第一条工作记录，开始记录你的工作
                </p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="inline-block rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
                >
                  新建工作记录
                </button>
              </div>
            </div>
          )}

          {/* Work record list */}
          {records.length > 0 && (
            <ul className="space-y-2">
              {records.map((record) => (
                <li
                  key={record.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <span
                      className={`font-medium ${
                        record.name === "未命名"
                          ? "text-gray-400 italic"
                          : "text-gray-900"
                      }`}
                    >
                      {record.name}
                    </span>
                    <span className="ml-3 text-xs text-gray-400">
                      {new Date(record.created_at).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDelete(record.id)}
                    disabled={deletingId === record.id}
                    className="ml-4 rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
                  >
                    {deletingId === record.id ? "删除中..." : "删除"}
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
