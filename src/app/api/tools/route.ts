import type { CustomTool } from "@/lib/shared/types";
import { builtinTools } from "@/lib/tools/builtin";
import { listCustomTools, parseWorkflow, saveCustomTool } from "@/lib/server/tools";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    builtin: Object.values(builtinTools).map((t) => ({ id: t.id, name: t.name })),
    custom: listCustomTools(),
  });
}

export async function POST(req: Request) {
  const b = (await req.json()) as Omit<CustomTool, "id" | "createdAt" | "updatedAt">;
  try {
    return Response.json(saveCustomTool({ ...b, workflow: parseWorkflow(b.workflow) as CustomTool["workflow"] }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
