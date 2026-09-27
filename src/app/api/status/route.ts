import { comfy } from "@/lib/server/comfy";
import { listModels } from "@/lib/server/llm";
import { getSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const [comfyOk, llm] = await Promise.all([
    comfy.ping(),
    listModels().then(
      () => true,
      () => false,
    ),
  ]);
  if (comfyOk) comfy.connect();
  return Response.json({ comfy: comfyOk, llm, llmModel: getSettings().llmModel });
}
