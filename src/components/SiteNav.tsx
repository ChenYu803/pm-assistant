"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import styles from "./SiteNav.module.css";

/**
 * 全站统一顶栏：左侧站名与标识回首页，右侧只有「迭代管理」「个人中心」两个去处。
 * 未登录时右侧只给「登录 / 注册」。视觉沿用 landing 的暗色导航。
 * 原型沙盒 /prototype 自带假顶栏，这里不渲染，避免双导航。
 */
export default function SiteNav() {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  if (pathname.startsWith("/prototype")) return null;

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link className={styles.brand} href="/" aria-label="AI 产品现场首页">
          <span className={styles.brandMark} aria-hidden="true">A</span>
          <span>AI 产品现场</span>
        </Link>

        <nav className={styles.actions} aria-label="主导航">
          {status === "loading" ? (
            <span className={styles.pending} aria-hidden="true" />
          ) : session?.user ? (
            <>
              <Link className={styles.link} href="/projects" data-active={pathname.startsWith("/projects") || pathname.startsWith("/workspace") ? "true" : undefined}>
                迭代管理
              </Link>
              <Link className={styles.link} href="/profile" data-active={pathname === "/profile" ? "true" : undefined}>
                个人中心
              </Link>
            </>
          ) : (
            <Link className={styles.enter} href="/login">登录 / 注册</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
