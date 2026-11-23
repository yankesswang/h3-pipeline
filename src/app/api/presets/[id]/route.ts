import type { ModelFamily, PresetPurpose } from "@/lib/shared/types";
import { deletePreset, updatePreset } from "@/lib/server/repo";

export async function PUT(req: Request, ctx: RouteContext<"/api/presets/[id]">) {
  const b = (await req.json()) as { name: string; family: ModelFamily; purpose: PresetPurpose; content: string };
  const p = updatePreset((await ctx.params).id, b);
  return p ? Response.json(p) : Response.json({ error: "找不到範本" }, { status: 404 });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/presets/[id]">) {
  return deletePreset((await ctx.params).id)
    ? new Response(null, { status: 204 })
    : Response.json({ error: "內建範本不能刪除" }, { status: 400 });
}
