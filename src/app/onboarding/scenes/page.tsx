import FirstWorkScene from "@/components/FirstWorkScene";
import WorkScenes from "@/components/WorkScenes";

export default async function WorkScenesPage({ searchParams }: { searchParams: Promise<{ scene?: string; entry?: string }> }) {
  const params = await searchParams;
  const scene = Number(params.scene ?? "1");
  const replayMotion = params.entry === "1";
  return scene >= 2 ? <WorkScenes key={`${scene}-${replayMotion ? "entry" : "direct"}`} initialScene={scene} replayMotion={replayMotion} /> : <FirstWorkScene />;
}
