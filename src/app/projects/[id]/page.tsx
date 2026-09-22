import ProductIterationList from "@/components/ProductIterationList";

interface WorkRecordsPageProps {
  params: Promise<{ id: string }>;
}

export default async function WorkRecordsPage({
  params,
}: WorkRecordsPageProps) {
  const { id } = await params;

  return <ProductIterationList projectId={id} />;
}
