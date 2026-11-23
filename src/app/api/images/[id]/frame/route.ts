import fs from "node:fs";
import { importUpload } from "@/lib/server/images";
import { bus } from "@/lib/server/queue";
import { getImage, imagePath, lastFramePath } from "@/lib/server/repo";
import { db } from "@/lib/server/db";

// Turn a video's first or last frame into an image of its own (a child of the
// video in the version tree), to edit it or to start the next clip from it.
export async function POST(req: Request, ctx: RouteContext<"/api/images/[id]/frame">) {
  const { id } = await ctx.params;
  const { which } = (await req.json()) as { which: "first" | "last" };
  const video = getImage(id);
  const p = which === "last" ? lastFramePath(id) : imagePath(id);
  if (video?.media !== "video" || !p || !fs.existsSync(p)) return Response.json({ error: "找不到這支影片的影格" }, { status: 404 });
  // Always a new record: it is re-parented below, which must never touch an earlier upload.
  const img = await importUpload(fs.readFileSync(p), which === "last" ? "影片最後一幀" : "影片第一幀", { dedupe: false });
  db.prepare("UPDATE images SET parent_id = ?, params = ? WHERE id = ?").run(
    id,
    JSON.stringify({ ...img.params, prompt: which === "last" ? "影片最後一幀" : "影片第一幀" }),
    img.id,
  );
  const saved = getImage(img.id)!;
  bus.emit("event", { type: "image", image: saved });
  return Response.json(saved);
}
