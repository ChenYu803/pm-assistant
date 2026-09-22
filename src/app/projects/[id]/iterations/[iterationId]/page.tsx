import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { findOwnedMysqlProductIteration } from "@/lib/mysql-account-workspace";

export default async function ProductIterationWorkspacePage({
  params,
}: {
  params: Promise<{ id: string; iterationId: string }>;
}) {
  const { id: projectId, iterationId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  const iteration = userId ? await findOwnedMysqlProductIteration(iterationId, userId) : null;
  if (!iteration || iteration.project_id !== projectId) notFound();

  return (
    <main className="iteration-placeholder-page">
      <div className="iteration-placeholder-topline"><Link href={`/projects/${projectId}`}>← 返回产品迭代</Link><span>ITERATION / {String(iteration.iteration_number).padStart(2, "0")}</span></div>
      <section className="iteration-placeholder-content"><p className="iteration-eyebrow">PRODUCT ITERATION WORKSPACE</p><h1>工作区已打开。</h1><p>这里的工作台界面由后续原型定义。</p><Link className="iteration-button iteration-button-primary" href={`/projects/${projectId}`}>回到迭代列表</Link></section>
    </main>
  );
}
