import { deleteImage, getImage } from "@/lib/server/repo";

/** Delete many images at once (gallery multi-select). Unknown ids are skipped. */
export async function POST(req: Request) {
  const { ids } = (await req.json()) as { ids?: unknown };
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return Response.json({ error: "ids 必須是字串陣列" }, { status: 400 });
  let deleted = 0;
  for (const id of new Set(ids as string[]))
    if (getImage(id)) {
      deleteImage(id);
      deleted++;
    }
  return Response.json({ deleted });
}
