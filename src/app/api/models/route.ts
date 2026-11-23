import { catalog, switchTo } from "@/lib/server/models";

export const dynamic = "force-dynamic";

/** Switchable models, which one ComfyUI holds, and any switch in progress. */
export async function GET() {
  return Response.json(await catalog());
}

/** Start switching the GPU to a model; poll GET for progress. */
export async function POST(req: Request) {
  const { target } = (await req.json()) as { target?: string };
  if (!target) return Response.json({ error: "缺少模型" }, { status: 400 });
  try {
    await switchTo(target);
    return new Response(null, { status: 202 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
