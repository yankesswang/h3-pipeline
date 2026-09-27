import { imageTree } from "@/lib/server/repo";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/images/[id]/tree">) {
  return Response.json(imageTree((await ctx.params).id));
}
