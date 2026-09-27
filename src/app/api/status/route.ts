import { execFile } from "node:child_process";
import { comfy } from "@/lib/server/comfy";
import { listModels } from "@/lib/server/llm";
import { getSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const vram = new Promise<number | null>((resolve) =>
    execFile("nvidia-smi", ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"], { timeout: 3000 }, (err, out) => {
      const [used, total] = String(out).split(",").map(Number);
      resolve(err || !total ? null : Math.round((100 * used) / total));
    }),
  );
  const [vramPct, comfyOk, llm] = await Promise.all([
    vram,
    comfy.ping(),
    listModels().then(
      () => true,
      () => false,
    ),
  ]);
  if (comfyOk) comfy.connect();
  return Response.json({ comfy: comfyOk, llm, llmModel: getSettings().llmModel, vramPct });
}
