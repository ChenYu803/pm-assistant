import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helper";
import { CAREER_DOCUMENT_FILENAME } from "@/lib/career-document";

const CAREER_DOCUMENT_SOURCE = path.join(
  process.cwd(),
  ".scratch",
  "pm-assistant-v1.4",
  "career-document.md",
);

export async function GET() {
  try {
    const userId = await requireAuth();
    if (userId instanceof NextResponse) return userId;

    const content = await readFile(CAREER_DOCUMENT_SOURCE);
    return new NextResponse(new Uint8Array(content), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(CAREER_DOCUMENT_FILENAME)}`,
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("GET /api/onboarding/career-document error:", error);
    return NextResponse.json({ error: "精炼学习笔记下载失败" }, { status: 500 });
  }
}
