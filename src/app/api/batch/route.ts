import type { BatchRequest } from "@/lib/shared/types";
import { startBatch } from "@/lib/server/batch";

// Start a batch edit: one queued edit job per image.
export async function POST(req: Request) {
  try {
    return Response.json(await startBatch((await req.json()) as BatchRequest));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
