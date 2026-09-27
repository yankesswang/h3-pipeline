import { history, sample } from "@/lib/server/monitor";

export const dynamic = "force-dynamic";

/** The last 5 minutes (if sampling), plus one fresh sample. */
export async function GET() {
  return Response.json({ history: history(), now: await sample() });
}
