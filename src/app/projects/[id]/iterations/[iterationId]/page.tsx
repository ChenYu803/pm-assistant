import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { findOwnedMysqlProductIteration, findOwnedMysqlProject } from "@/lib/mysql-account-workspace";
import ProductIterationWorkbench from "@/components/ProductIterationWorkbench";
import { TEST_PROJECT_DEMO_SESSIONS } from "@/lib/test-project-demo-sessions";

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

  // 演示内容只绑定到验收用账号的这一条项目记录。
  const showDemoSessions = session?.user?.email?.trim().toLowerCase() === "test1@example.com"
    && project.id === "5eac1c6e-5154-436f-9586-343241301bda";
  return <ProductIterationWorkbench project={project} iteration={iteration} demoSessions={showDemoSessions ? TEST_PROJECT_DEMO_SESSIONS : []} />;
}
