import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helper";
import dbConnect from "@/lib/mongodb";
import { findOwnedProjectFile } from "@/lib/ownership";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const { fileId } = await params;

    await dbConnect();

    const file = await findOwnedProjectFile(fileId, userId);
    if (!file) {
      return NextResponse.json(
        { error: "文件不存在或无权访问" },
        { status: 404 }
      );
    }

    return new NextResponse(file.content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      },
    });
  } catch (error) {
    console.error("GET /api/projects/[id]/files/[fileId]/download error:", error);
    return NextResponse.json(
      { error: "下载文件失败" },
      { status: 500 }
    );
  }
}
