import type { GenerateRequest } from "@/lib/shared/types";
import { saveMask } from "@/lib/server/masks";
import { enqueue, listJobs } from "@/lib/server/queue";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listJobs());
}

export async function POST(req: Request) {
  const body = (await req.json()) as GenerateRequest;
  const p = body.params;
  // Outpainting has a built-in instruction, so its prompt may be empty.
  if (!p?.prompt?.trim() && !p?.outpaint) return Response.json({ error: "prompt 不能是空的" }, { status: 400 });
  const count = Math.min(Math.max(1, body.count || 1), 8);
  const tool = body.tool ?? (p.sourceImageId ? "qwen21-edit" : "qwen21-t2i");
  try {
    if (body.mask) p.maskId = saveMask(body.mask);
    const jobs = Array.from({ length: count }, (_, i) => enqueue(tool, { ...p, seed: p.seed + i }, body.origin));
    return Response.json(jobs);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
