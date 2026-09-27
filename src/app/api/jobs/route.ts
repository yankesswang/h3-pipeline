import type { GenerateRequest } from "@/lib/shared/types";
import { enqueue, listJobs } from "@/lib/server/queue";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listJobs());
}

export async function POST(req: Request) {
  const body = (await req.json()) as GenerateRequest;
  const p = body.params;
  if (!p?.prompt?.trim()) return Response.json({ error: "prompt 不能是空的" }, { status: 400 });
  const count = Math.min(Math.max(1, body.count || 1), 8);
  const jobs = Array.from({ length: count }, (_, i) =>
    enqueue("qwen21-t2i", { ...p, seed: p.seed + i }, body.origin),
  );
  return Response.json(jobs);
}
