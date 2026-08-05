import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import Project from "@/models/Project";

export async function GET() {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    await dbConnect();

    const projects = await Project.find({ user_id: userId })
      .sort({ created_at: -1 })
      .lean();

    return NextResponse.json(
      projects.map((p) => ({
        id: p._id.toString(),
        name: p.name,
        created_at: p.created_at,
      }))
    );
  } catch (error) {
    console.error("GET /api/projects error:", error);
    return NextResponse.json(
      { error: "获取项目列表失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "项目名称不能为空" },
        { status: 400 }
      );
    }

    await dbConnect();

    const project = await Project.create({
      name: name.trim(),
      user_id: userId,
    });

    return NextResponse.json(
      {
        id: project._id.toString(),
        name: project.name,
        created_at: project.created_at,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/projects error:", error);
    return NextResponse.json(
      { error: "创建项目失败" },
      { status: 500 }
    );
  }
}
