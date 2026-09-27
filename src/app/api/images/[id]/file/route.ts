import fs from "node:fs";
import { thumbnail } from "@/lib/server/images";
import { imagePath } from "@/lib/server/repo";

const THUMB_WIDTHS = [160, 320, 640];

export async function GET(req: Request, ctx: RouteContext<"/api/images/[id]/file">) {
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  // Images never change once written.
  const cache = { "cache-control": "public, max-age=31536000, immutable" };

  const w = Number(sp.get("w"));
  if (w) {
    const width = THUMB_WIDTHS.find((t) => t >= w) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
    const buf = await thumbnail(id, width);
    return buf
      ? new Response(new Uint8Array(buf), { headers: { "content-type": "image/webp", ...cache } })
      : new Response(null, { status: 404 });
  }

  const p = imagePath(id);
  if (!p || !fs.existsSync(p)) return new Response(null, { status: 404 });
  return new Response(fs.readFileSync(p), {
    headers: {
      "content-type": "image/png",
      ...cache,
      ...(sp.has("download") ? { "content-disposition": `attachment; filename="comfy-studio-${id}.png"` } : {}),
    },
  });
}
