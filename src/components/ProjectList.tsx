"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);

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

  /** 删除确认弹窗的「删除」动作。 */
  async function confirmDelete() {
    if (!pendingDelete) return;

    setDeletingId(pendingDelete.id);
    try {
      const res = await fetch(`/api/projects/${pendingDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "删除失败");
      }
      setProjects((prev) => prev.filter((p) => p.id !== pendingDelete.id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除项目失败");
    } finally {
      setDeletingId(null);
      setPendingDelete(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      ) : error && projects.length === 0 ? (
        /* Error state (only when no stale data to show) */
        <div className="flex flex-1 items-center justify-center py-20">
          <div className="text-center">
            <div className="mb-4 text-5xl">⚠️</div>
            <h2 className="mb-2 text-xl font-semibold">加载失败</h2>
            <p className="mb-6 text-sm text-muted-foreground">{error}</p>
            <Button variant="default" size="lg" onClick={fetchProjects}>
              重试
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-semibold">我的项目</h1>
            <Button
              variant="default"
              onClick={() => setShowCreate(!showCreate)}
            >
              {showCreate ? "取消" : "新建项目"}
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

          {/* Create form */}
          {showCreate && (
            <form
              onSubmit={handleCreate}
              className="mb-6 rounded-lg border border-border bg-card p-4"
            >
              <Label className="mb-2 block">项目名称</Label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="输入项目名称"
                  className="flex-1"
                  autoFocus
                />
                <Button
                  type="submit"
                  disabled={creating || !newName.trim()}
                >
                  {creating ? "创建中..." : "创建"}
                </Button>
              </div>
            </form>
          )}

          {/* Empty state */}
          {!error && projects.length === 0 && !showCreate && (
            <div className="flex flex-1 items-center justify-center py-20">
              <div className="text-center">
                <div className="mb-4 text-5xl">📋</div>
                <h2 className="mb-2 text-xl font-semibold">还没有项目</h2>
                <p className="mb-6 text-sm text-muted-foreground">
                  创建你的第一个项目，开始用 AI 驱动产品工作流
                </p>
                <Button size="lg" onClick={() => setShowCreate(true)}>
                  创建第一个项目
                </Button>
              </div>
            </div>
          )}

          {/* Project list */}
          {projects.length > 0 && (
            <ul className="space-y-2">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-gray-300"
                >
                  <Link
                    href={`/projects/${project.id}`}
                    className="min-w-0 flex-1"
                  >
                    <span className="font-medium transition-colors hover:text-muted-foreground">
                      {project.name}
                    </span>
                    <span className="ml-3 text-xs text-muted-foreground">
                      {new Date(project.created_at).toLocaleDateString("zh-CN")}
                    </span>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDelete(project)}
                    disabled={deletingId === project.id}
                    className="ml-4 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    {deletingId === project.id ? "删除中..." : "删除"}
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
          <AlertDialogTitle>确定删除该项目？</AlertDialogTitle>
          <AlertDialogDescription>
            项目「{pendingDelete?.name}」及其所有工作记录将被永久删除，此操作不可恢复。
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
