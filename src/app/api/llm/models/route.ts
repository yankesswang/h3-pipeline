import { listModels } from "@/lib/server/llm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ models: await listModels() });
  } catch (e) {
    return Response.json({ models: [], error: e instanceof Error ? e.message : String(e) });
  }
}
