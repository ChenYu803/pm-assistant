import type { Metadata } from "next";
import Providers from "@/components/Providers";
import SiteNav from "@/components/SiteNav";
import "./globals.css";
import "./workbench-quality.css";

export const metadata: Metadata = {
  title: "AI 产品现场",
  description: "AI 产品经理入职体验与产品实践",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      {/* 高度锁定为视口：main 是唯一的页面滚动容器（min-h-0 + overflow-y-auto），
          workspace 页内部靠各自 overflow 容器独立滚动，聊天区不会撑长页面。
          顶栏在 main 之外，全站常驻且不随内容滚走。 */}
      <body className="h-full flex flex-col">
        <Providers>
          <SiteNav />
          <main className="flex-1 min-h-0 overflow-y-auto flex flex-col">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
