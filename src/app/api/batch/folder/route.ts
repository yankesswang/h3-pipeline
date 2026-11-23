import { listFolder } from "@/lib/server/batch";

export const dynamic = "force-dynamic";

/** Subfolders and images of a folder on this machine, for picking a batch source. */
export function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("path") ?? "~";
  try {
    return Response.json(listFolder(p));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
