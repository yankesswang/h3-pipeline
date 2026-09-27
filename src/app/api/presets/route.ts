import type { ModelFamily, PresetPurpose } from "@/lib/shared/types";
import { createPreset, listPresets } from "@/lib/server/repo";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listPresets());
}

export async function POST(req: Request) {
  const b = (await req.json()) as { name?: string; family?: ModelFamily; content?: string; purpose?: PresetPurpose };
  if (!b.name?.trim() || !b.content?.trim()) return Response.json({ error: "名稱和內容都要填" }, { status: 400 });
  return Response.json(createPreset({ name: b.name.trim(), family: b.family ?? "generic", purpose: b.purpose ?? "generate", content: b.content }));
}
