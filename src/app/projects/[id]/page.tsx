import WorkRecordList from "@/components/WorkRecordList";

interface WorkRecordsPageProps {
  params: Promise<{ id: string }>;
}

export default async function WorkRecordsPage({
  params,
}: WorkRecordsPageProps) {
  const { id } = await params;

  return <WorkRecordList projectId={id} />;
}
