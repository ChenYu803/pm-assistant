export type WorkbenchFileStage = "analysis" | "prototype" | "prd" | "tickets";

export function getWorkbenchFileStage(filename: string): WorkbenchFileStage {
  if (filename.startsWith("issues/")) return "tickets";
  if (filename.startsWith("原型")) return "prototype";
  if (filename.toLowerCase().startsWith("prd")) return "prd";
  return "analysis";
}
