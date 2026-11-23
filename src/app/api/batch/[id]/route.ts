import { cancelBatch } from "@/lib/server/batch";

/** Cancel whatever is left of a batch. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/batch/[id]">) {
  const { id } = await ctx.params;
  return Response.json({ cancelled: await cancelBatch(id) });
}
