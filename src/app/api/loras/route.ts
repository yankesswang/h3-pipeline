import { listLoras, loraFolders } from "@/lib/server/loras";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ loras: await listLoras(), folders: await loraFolders() });
  } catch (e) {
    return Response.json({ loras: [], folders: [], error: e instanceof Error ? e.message : String(e) });
  }
}
