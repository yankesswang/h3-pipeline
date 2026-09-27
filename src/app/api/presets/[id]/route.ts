import type { ModelFamily } from "@/lib/shared/types";
import { deletePreset, updatePreset } from "@/lib/server/repo";

export async function PUT(req: Request, ctx: RouteContext<"/api/presets/[id]">) {
  const b = (await req.json()) as { name: string; family: ModelFamily; content: string };
  const p = updatePreset((await ctx.params).id, b);
  return p ? Response.json(p) : Response.json({ error: "內建範本不能修改，請先複製" }, { status: 400 });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/presets/[id]">) {
  return deletePreset((await ctx.params).id)
    ? new Response(null, { status: 204 })
    : Response.json({ error: "內建範本不能刪除" }, { status: 400 });
}
