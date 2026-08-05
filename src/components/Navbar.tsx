"use client";

import { useSession } from "next-auth/react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  // Don't show navbar on auth pages
  if (pathname === "/login" || pathname === "/register") {
    return null;
  }

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/projects" className="text-lg font-semibold text-gray-900">
          PM Assistant
        </Link>

        <div className="flex items-center gap-4">
          {status === "loading" ? (
            <span className="text-sm text-gray-400">加载中...</span>
          ) : session?.user ? (
            <>
              <span className="text-sm text-gray-600">
                {session.user.email}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => signOut({ redirectTo: "/login" })}
              >
                退出
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
