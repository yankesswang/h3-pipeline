import fs from "node:fs";
import { thumbnail } from "@/lib/server/images";
import { getImage, imagePath, lastFramePath, mediaPath } from "@/lib/server/repo";

const THUMB_WIDTHS = [160, 320, 640];
// Files never change once written.
const CACHE = { "cache-control": "public, max-age=31536000, immutable" };

/**
 * The record's file: PNG, or mp4 for videos (with Range support so players can seek).
 * `?w=` gives a WebP thumbnail (a video's first frame); `?frame=first|last` a video frame as PNG.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/images/[id]/file">) {
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;

  const w = Number(sp.get("w"));
  if (w) {
    const width = THUMB_WIDTHS.find((t) => t >= w) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
    const buf = await thumbnail(id, width);
    return buf
      ? new Response(new Uint8Array(buf), { headers: { "content-type": "image/webp", ...CACHE } })
      : new Response(null, { status: 404 });
  }

  const frame = sp.get("frame");
  const p = frame === "last" ? lastFramePath(id) : frame === "first" ? imagePath(id) : mediaPath(id);
  if (!p || !fs.existsSync(p)) return new Response(null, { status: 404 });
  const video = p.endsWith(".mp4");
  const type = video ? "video/mp4" : "image/png";
  const download: Record<string, string> = sp.has("download")
    ? { "content-disposition": `attachment; filename="comfy-studio-${id}${video ? ".mp4" : ".png"}"` }
    : {};

  const size = fs.statSync(p).size;
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (video && range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    const fd = fs.openSync(p, "r");
    const buf = Buffer.alloc(end - start + 1);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return new Response(new Uint8Array(buf), {
      status: 206,
      headers: { "content-type": type, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": String(buf.length), ...CACHE },
    });
  }
  if (!getImage(id)) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(p)), {
    headers: { "content-type": type, "accept-ranges": "bytes", "content-length": String(size), ...CACHE, ...download },
  });
}
