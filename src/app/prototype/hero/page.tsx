import { notFound } from "next/navigation";
import HeroTurntablePrototype from "@/components/prototype/HeroTurntablePrototype";

export const metadata = { title: "首屏原型 — 成果转台", robots: { index: false, follow: false } };

/* 一次性原型：生产环境不存在，避免被当成真实页面收录。 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <HeroTurntablePrototype />;
}
