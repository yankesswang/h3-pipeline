import { deleteImage, getImage, setFavorite } from "@/lib/server/repo";

export async function GET(_req: Request, ctx: RouteContext<"/api/images/[id]">) {
  const img = getImage((await ctx.params).id);
  return img ? Response.json(img) : new Response(null, { status: 404 });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/images/[id]">) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { favorite?: boolean };
  if (typeof body.favorite === "boolean") setFavorite(id, body.favorite);
  const img = getImage(id);
  return img ? Response.json(img) : new Response(null, { status: 404 });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/images/[id]">) {
  deleteImage((await ctx.params).id);
  return new Response(null, { status: 204 });
}
