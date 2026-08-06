import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Providers from "@/components/Providers";
import Navbar from "@/components/Navbar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PM Assistant",
  description: "AI 驱动产品经理工作流助手",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* 高度锁定为视口：main 是唯一的页面滚动容器（min-h-0 + overflow-y-auto），
          workspace 页内部靠各自 overflow 容器独立滚动，聊天区不会撑长页面 */}
      <body className="h-full flex flex-col bg-gray-50">
        <Providers>
          <Navbar />
          <main className="flex-1 min-h-0 overflow-y-auto flex flex-col">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
