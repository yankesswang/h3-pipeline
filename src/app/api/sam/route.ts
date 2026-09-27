import { samDownload, segment, type SamPoint } from "@/lib/server/sam";

export const dynamic = "force-dynamic";

/** Whether click-to-select is available yet; the first call starts the one-time model download. */
export function GET() {
  return Response.json(samDownload());
}

export async function POST(req: Request) {
  const b = (await req.json()) as { imageId: string; points: SamPoint[]; box?: [number, number, number, number] };
  try {
    return Response.json(await segment(b.imageId, b.points ?? [], b.box));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
