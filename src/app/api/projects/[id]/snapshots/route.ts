import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import PrototypeSnapshot from "@/models/PrototypeSnapshot";
import { findOwnedProject } from "@/lib/ownership";
import { MAX_FILE_BYTES } from "@/lib/file-helpers";
import { acquireProjectWriteLease } from "@/lib/deletion-coordination";
import { isMysqlId } from "@/lib/identifiers";
import { createMysqlSnapshot, listMysqlSnapshots } from "@/lib/mysql-project-artifacts";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: projectId } = await params;
    if (isMysqlId(projectId)) {
      const snapshots = await listMysqlSnapshots(projectId, userId);
      if (!snapshots) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
      return NextResponse.json(snapshots.map((snapshot) => ({ id: snapshot.id, version: Number(snapshot.version), tab_id: snapshot.tab_id, created_at: snapshot.created_at })));
    }
    await dbConnect();
    const project = await findOwnedProject(projectId, userId);
    if (!project) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });

    const snapshots = await PrototypeSnapshot.find({ project_id: project._id })
      .sort({ version: -1 })
      .select("_id version tab_id created_at")
      .lean();
    return NextResponse.json(
      snapshots.map((snapshot) => ({
        id: snapshot._id.toString(),
        version: snapshot.version,
        tab_id: snapshot.tab_id?.toString(),
        created_at: snapshot.created_at,
      }))
    );
  } catch (error) {
    console.error("GET /api/projects/[id]/snapshots error:", error);
    return NextResponse.json({ error: "获取 HTML 快照列表失败" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;
    const { id: projectId } = await params;
    const body = await request.json();
    const { content, tab_id: tabId } = body as { content?: unknown; tab_id?: unknown };
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "HTML 快照内容不能为空" }, { status: 400 });
    }
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "HTML 快照超过 3 MiB 上限" }, { status: 413 });
    }

    if (isMysqlId(projectId)) {
      if (typeof tabId === "string" && !isMysqlId(tabId)) return NextResponse.json({ error: "tabId 参数无效" }, { status: 400 });
      const result = await createMysqlSnapshot({ projectId, userId, ...(typeof tabId === "string" ? { tabId } : {}), content });
      if (result.kind === "project-not-found") return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
      if (result.kind === "tab-not-found") return NextResponse.json({ error: "标签页不存在或不属于当前项目" }, { status: 404 });
      const snapshot = result.snapshot;
      return NextResponse.json({ id: snapshot.id, version: Number(snapshot.version), tab_id: snapshot.tab_id, content: snapshot.content, created_at: snapshot.created_at }, { status: 201 });
    }

    await dbConnect();
    const writeLease = await acquireProjectWriteLease(projectId, userId);
    if (!writeLease) return NextResponse.json({ error: "项目不存在或无权访问" }, { status: 404 });
    const project = writeLease.project;

    try {
      let tabObjectId: mongoose.Types.ObjectId | undefined;
      if (typeof tabId === "string") {
        const { findOwnedTabWithProject, parseObjectId } = await import("@/lib/ownership");
        if (!parseObjectId(tabId)) return NextResponse.json({ error: "tabId 参数无效" }, { status: 400 });
        const ownedTab = await findOwnedTabWithProject(tabId, userId);
        if (!ownedTab || ownedTab.project._id.toString() !== project._id.toString()) {
          return NextResponse.json({ error: "标签页不存在或不属于当前项目" }, { status: 404 });
        }
        tabObjectId = ownedTab.tab._id;
      }

      const latest = await PrototypeSnapshot.findOne({ project_id: project._id })
        .sort({ version: -1 })
        .select("version")
        .lean();
      const snapshot = await PrototypeSnapshot.create({
        project_id: project._id,
        ...(tabObjectId ? { tab_id: tabObjectId } : {}),
        content,
        version: (latest?.version ?? 0) + 1,
        created_at: new Date(),
      });
      return NextResponse.json(
        {
          id: snapshot._id.toString(),
          version: snapshot.version,
          tab_id: snapshot.tab_id?.toString(),
          content: snapshot.content,
          created_at: snapshot.created_at,
        },
        { status: 201 }
      );
    } finally {
      await writeLease.release();
    }
  } catch (error) {
    console.error("POST /api/projects/[id]/snapshots error:", error);
    return NextResponse.json({ error: "保存 HTML 快照失败" }, { status: 500 });
  }
}
