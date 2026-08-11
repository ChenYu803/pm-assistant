"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import InlineNameInput from "@/components/InlineNameInput";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const [pendingDelete, setPendingDelete] = useState<WorkRecord | null>(null);
  // 创建面板的名称输入（可选，留空 = 「未命名」+ AI 自动命名兜底）
  const [newName, setNewName] = useState("");
  // 行内改名的目标记录 id（配合 InlineNameInput 使用）
  const [renamingId, setRenamingId] = useState<string | null>(null);

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
        body: JSON.stringify({ name: newName.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建失败");
      }
      setShowCreate(false);
      setNewName("");
      await fetchRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建工作记录失败");
    } finally {
      setCreating(false);
    }
  }

  /** 行内改名：PATCH 成功后更新本地列表。 */
  async function handleRename(id: string, newName: string) {
    setRenamingId(null);
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`/api/work-records/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "改名失败");
      }
      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, name: trimmed } : r))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "改名失败");
    }
  }

  /** 删除确认弹窗的「删除」动作。 */
  async function confirmDelete() {
    if (!pendingDelete) return;

    setDeletingId(pendingDelete.id);
    try {
      const res = await fetch(`/api/work-records/${pendingDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "删除失败");
      }
      setRecords((prev) => prev.filter((r) => r.id !== pendingDelete.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除工作记录失败");
    } finally {
      setDeletingId(null);
      setPendingDelete(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link
          href="/projects"
          className="underline underline-offset-2 transition-colors hover:text-foreground"
        >
          项目列表
        </Link>
        <span className="mx-2">/</span>
        <span className="font-medium text-foreground">
          {project?.name || "项目"}
        </span>
      </nav>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      ) : error && records.length === 0 ? (
        /* Error state (only when no stale data to show) */
        <div className="flex flex-1 items-center justify-center py-20">
          <div className="text-center">
            <div className="mb-4 text-5xl">⚠️</div>
            <h2 className="mb-2 text-xl font-semibold">加载失败</h2>
            <p className="mb-6 text-sm text-muted-foreground">{error}</p>
            <Button variant="default" size="lg" onClick={fetchRecords}>
              重试
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-semibold">工作记录</h1>
            <Button
              variant="default"
              onClick={() => setShowCreate(!showCreate)}
            >
              {showCreate ? "取消" : "新建工作记录"}
            </Button>
          </div>

          {/* Error banner (shown above content when stale data exists) */}
          {error && (
            <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-destructive">
              {error}
              <button
                onClick={() => setError("")}
                className="ml-2 underline underline-offset-2"
              >
                关闭
              </button>
            </div>
          )}

          {/* Create panel: 名称可选，输入 + 回车即创建（v1.1 创建一步化） */}
          {showCreate && (
            <div className="mb-6 rounded-lg border border-border bg-card p-4">
              <p className="mb-3 text-sm text-muted-foreground">
                输入名称后回车即创建；留空将显示「未命名」，首次对话后由 AI 自动命名（手动命名后 AI 不再覆盖）。
              </p>
              <div className="flex gap-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    else if (e.key === "Escape") setShowCreate(false);
                  }}
                  placeholder="工作记录名称（可选）"
                  autoFocus
                  className="flex-1"
                  disabled={creating}
                />
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? "创建中..." : "创建"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowCreate(false);
                    setNewName("");
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!error && records.length === 0 && !showCreate && (
            <div className="flex flex-1 items-center justify-center py-20">
              <div className="text-center">
                <div className="mb-4 text-5xl">📝</div>
                <h2 className="mb-2 text-xl font-semibold">还没有工作记录</h2>
                <p className="mb-6 text-sm text-muted-foreground">
                  创建第一条工作记录，开始记录你的工作
                </p>
                <Button size="lg" onClick={() => setShowCreate(true)}>
                  新建工作记录
                </Button>
              </div>
            </div>
          )}

          {/* Work record list */}
          {records.length > 0 && (
            <ul className="space-y-2">
              {records.map((record) => (
                <li
                  key={record.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-gray-300"
                >
                  <div className="min-w-0 flex-1">
                    {renamingId === record.id ? (
                      <InlineNameInput
                        value={record.name}
                        onSubmit={(n) => handleRename(record.id, n)}
                        onCancel={() => setRenamingId(null)}
                        className="w-48"
                      />
                    ) : (
                      <Link
                        href={`/workspace/${record.id}`}
                        className={`font-medium underline-offset-2 transition-colors hover:text-muted-foreground hover:underline ${
                          record.name === "未命名"
                            ? "italic text-muted-foreground"
                            : "text-foreground"
                        }`}
                      >
                        {record.name}
                      </Link>
                    )}
                    <span className="ml-3 text-xs text-muted-foreground">
                      {new Date(record.created_at).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRenamingId(record.id)}
                    disabled={renamingId === record.id}
                    className="ml-4 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  >
                    改名
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDelete(record)}
                    disabled={deletingId === record.id}
                    className="ml-1 text-gray-500 hover:bg-red-50 hover:text-red-600"
                  >
                    {deletingId === record.id ? "删除中..." : "删除"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* 删除确认弹窗 */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>确定删除该工作记录？</AlertDialogTitle>
          <AlertDialogDescription>
            工作记录「{pendingDelete?.name}」及其所有对话记录将被永久删除，此操作不可恢复。
          </AlertDialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline">取消</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={deletingId !== null}
              >
                {deletingId !== null ? "删除中..." : "删除"}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
