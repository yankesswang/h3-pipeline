import type { CustomTool } from "@/lib/shared/types";
import { deleteCustomTool, getCustomTool, parseWorkflow, saveCustomTool } from "@/lib/server/tools";

export async function GET(_req: Request, ctx: RouteContext<"/api/tools/[id]">) {
  const t = getCustomTool((await ctx.params).id);
  return t ? Response.json(t) : Response.json({ error: "找不到這個工具" }, { status: 404 });
}

export async function PUT(req: Request, ctx: RouteContext<"/api/tools/[id]">) {
  const b = (await req.json()) as Omit<CustomTool, "id" | "createdAt" | "updatedAt">;
  try {
    return Response.json(saveCustomTool({ ...b, workflow: parseWorkflow(b.workflow) as CustomTool["workflow"] }, (await ctx.params).id));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/tools/[id]">) {
  deleteCustomTool((await ctx.params).id);
  return new Response(null, { status: 204 });
}
