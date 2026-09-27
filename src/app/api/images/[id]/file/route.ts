import fs from "node:fs";
import { imagePath } from "@/lib/server/repo";

export async function GET(req: Request, ctx: RouteContext<"/api/images/[id]/file">) {
  const { id } = await ctx.params;
  const p = imagePath(id);
  if (!p || !fs.existsSync(p)) return new Response(null, { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  return new Response(fs.readFileSync(p), {
    headers: {
      "content-type": "image/png",
      // Images never change once written.
      "cache-control": "public, max-age=31536000, immutable",
      ...(download ? { "content-disposition": `attachment; filename="comfy-studio-${id}.png"` } : {}),
    },
  });
}
