import type { Settings } from "@/lib/shared/types";
import { publicSettings, saveSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(publicSettings());
}

export async function PUT(req: Request) {
  const patch = (await req.json()) as Partial<Settings>;
  // An empty key field means "leave the stored key alone".
  if (patch.llmApiKey === "") delete patch.llmApiKey;
  saveSettings(patch);
  return Response.json(publicSettings());
}
