import { resetPreset } from "@/lib/server/repo";

export async function POST(_req: Request, ctx: RouteContext<"/api/presets/[id]/reset">) {
  const p = resetPreset((await ctx.params).id);
  return p ? Response.json(p) : Response.json({ error: "只有內建範本能還原預設" }, { status: 400 });
}
