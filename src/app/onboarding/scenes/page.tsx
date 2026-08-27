import FirstWorkScene from "@/components/FirstWorkScene";
import WorkScenes from "@/components/WorkScenes";

export default async function WorkScenesPage({ searchParams }: { searchParams: Promise<{ scene?: string }> }) {
  const params = await searchParams;
  const scene = Number(params.scene ?? "1");
  return scene >= 2 ? <WorkScenes key={scene} initialScene={scene} /> : <FirstWorkScene />;
}
