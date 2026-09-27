import type { GenerateRequest } from "@/lib/shared/types";
import { saveMask } from "@/lib/server/masks";
import { enqueue, listJobs } from "@/lib/server/queue";
import { customFields } from "@/lib/server/tools";

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
    // Several at once: bump every seed so each result differs.
    const seedKeys = customFields(tool).filter((f) => f.kind === "seed").map((f) => f.key);
    const jobs = Array.from({ length: count }, (_, i) => {
      const toolValues = p.toolValues && { ...p.toolValues };
      for (const k of seedKeys) if (toolValues) toolValues[k] = Number(toolValues[k]) + i;
      return enqueue(tool, { ...p, seed: p.seed + i, toolValues }, body.origin);
    });
    return Response.json(jobs);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
