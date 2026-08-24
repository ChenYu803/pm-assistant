import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import { createMysqlProject, listMysqlProjects } from "@/lib/mysql-account-workspace";
import { mysqlUnavailableMessage } from "@/lib/mysql";

export async function GET() {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const projects = await listMysqlProjects(userId);
    return NextResponse.json(projects.map(({ id, name, created_at }) => ({ id, name, created_at })));
  } catch (error) {
    console.error("GET /api/projects error:", error);
    return NextResponse.json(
      { error: mysqlUnavailableMessage() },
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

    const project = await createMysqlProject(userId, name.trim());

    return NextResponse.json(
      {
        id: project.id,
        name: project.name,
        created_at: project.created_at,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/projects error:", error);
    return NextResponse.json(
      { error: mysqlUnavailableMessage() },
      { status: 500 }
    );
  }
}
