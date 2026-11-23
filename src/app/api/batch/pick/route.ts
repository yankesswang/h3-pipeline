import { pickFolder } from "@/lib/server/batch";

/** Open the desktop's folder picker; `path` is null when it was cancelled. */
export async function POST(req: Request) {
  const { start } = (await req.json().catch(() => ({}))) as { start?: string };
  try {
    return Response.json({ path: (await pickFolder(start ?? "~")) ?? null });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
