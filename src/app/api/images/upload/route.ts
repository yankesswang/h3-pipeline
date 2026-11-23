import { importUpload } from "@/lib/server/images";
import { bus } from "@/lib/server/queue";

// Bring outside images in (drag and drop, paste, file picker). Each becomes the
// root of its own version tree; a picture uploaded before comes back as that earlier upload.
export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: "沒有收到檔案" }, { status: 400 });
  try {
    const images = [];
    for (const f of files) {
      const img = await importUpload(Buffer.from(await f.arrayBuffer()), f.name);
      if (!img.duplicate) bus.emit("event", { type: "image", image: img });
      images.push(img);
    }
    return Response.json(images);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
