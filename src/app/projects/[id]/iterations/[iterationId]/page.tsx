import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { findOwnedMysqlProductIteration, findOwnedMysqlProject } from "@/lib/mysql-account-workspace";
import ProductIterationWorkbench from "@/components/ProductIterationWorkbench";

export default async function ProductIterationWorkspacePage({
  params,
}: {
  params: Promise<{ id: string; iterationId: string }>;
}) {
  const { id: projectId, iterationId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  const [iteration, project] = userId
    ? await Promise.all([
        findOwnedMysqlProductIteration(iterationId, userId),
        findOwnedMysqlProject(projectId, userId),
      ])
    : [null, null];
  if (!iteration || iteration.project_id !== projectId || !project) notFound();

  return <ProductIterationWorkbench project={project} iteration={iteration} />;
}
