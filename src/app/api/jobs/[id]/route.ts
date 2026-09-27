import { cancel } from "@/lib/server/queue";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  return (await cancel(id)) ? new Response(null, { status: 204 }) : new Response(null, { status: 404 });
}
