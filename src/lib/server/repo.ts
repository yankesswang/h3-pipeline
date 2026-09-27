import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ImageRecord, ModelFamily, Preset, PresetPurpose } from "@/lib/shared/types";
import { db, IMAGE_DIR, THUMB_DIR } from "./db";

// ---- images ----------------------------------------------------------------

interface ImageRow {
  id: string;
  tool: string;
  params: string;
  origin: string | null;
  parent_id: string | null;
  width: number;
  height: number;
  file: string;
  favorite: number;
  created_at: number;
  media: string;
  duration: number | null;
}

function toImage(r: ImageRow): ImageRecord {
  return {
    id: r.id,
    tool: r.tool as ImageRecord["tool"],
    params: JSON.parse(r.params),
    origin: r.origin ? JSON.parse(r.origin) : undefined,
    parentId: r.parent_id ?? undefined,
    width: r.width,
    height: r.height,
    favorite: r.favorite === 1,
    createdAt: r.created_at,
    media: r.media === "video" ? "video" : "image",
    duration: r.duration ?? undefined,
  };
}

/**
 * Every record has `<id>.png`: the image itself, or a video's first frame.
 * Videos add `<id>.mp4` and `<id>.last.png` (the last frame, for continuing).
 */
export function insertImage(img: ImageRecord, png: Buffer, video?: { mp4: Buffer; last: Buffer }): ImageRecord {
  fs.writeFileSync(path.join(IMAGE_DIR, `${img.id}.png`), png);
  const file = video ? `${img.id}.mp4` : `${img.id}.png`;
  if (video) {
    fs.writeFileSync(path.join(IMAGE_DIR, file), video.mp4);
    fs.writeFileSync(path.join(IMAGE_DIR, `${img.id}.last.png`), video.last);
  }
  db.prepare(
    `INSERT INTO images (id, tool, params, origin, parent_id, width, height, file, favorite, created_at, media, duration)
     VALUES (@id, @tool, @params, @origin, @parent_id, @width, @height, @file, 0, @created_at, @media, @duration)`,
  ).run({
    id: img.id,
    tool: img.tool,
    params: JSON.stringify(img.params),
    origin: img.origin ? JSON.stringify(img.origin) : null,
    parent_id: img.parentId ?? null,
    width: img.width,
    height: img.height,
    file,
    created_at: img.createdAt,
    media: img.media,
    duration: img.duration ?? null,
  });
  return img;
}

export function listImages(opts: { before?: number; limit: number; favorites?: boolean; q?: string }) {
  const where: string[] = [];
  const args: Record<string, unknown> = { limit: opts.limit };
  if (opts.before) {
    where.push("created_at < @before");
    args.before = opts.before;
  }
  if (opts.favorites) where.push("favorite = 1");
  if (opts.q) {
    where.push("params LIKE @q");
    args.q = `%${opts.q}%`;
  }
  const sql = `SELECT * FROM images ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY created_at DESC LIMIT @limit`;
  return (db.prepare(sql).all(args) as ImageRow[]).map(toImage);
}

export function getImage(id: string) {
  const r = db.prepare("SELECT * FROM images WHERE id = ?").get(id) as ImageRow | undefined;
  return r ? toImage(r) : undefined;
}

/** The PNG for a record: the image, or a video's first frame. */
export function imagePath(id: string) {
  const r = db.prepare("SELECT id FROM images WHERE id = ?").get(id) as { id: string } | undefined;
  return r ? path.join(IMAGE_DIR, `${r.id}.png`) : undefined;
}

/** The record's main file: the PNG, or the mp4 for a video. */
export function mediaPath(id: string) {
  const r = db.prepare("SELECT file FROM images WHERE id = ?").get(id) as { file: string } | undefined;
  return r ? path.join(IMAGE_DIR, r.file) : undefined;
}

/** A video's last frame. */
export function lastFramePath(id: string) {
  const p = path.join(IMAGE_DIR, `${id}.last.png`);
  return getImage(id)?.media === "video" && fs.existsSync(p) ? p : undefined;
}

/** Every image in the same version tree as `id`: walk up to the root, then collect all descendants. */
export function imageTree(id: string) {
  const rows = db
    .prepare(
      `WITH RECURSIVE up(id, parent_id) AS (
         SELECT id, parent_id FROM images WHERE id = @id
         UNION ALL SELECT i.id, i.parent_id FROM images i JOIN up ON i.id = up.parent_id
       ),
       root AS (SELECT id FROM up WHERE parent_id IS NULL OR parent_id NOT IN (SELECT id FROM images)),
       down(id) AS (
         SELECT id FROM root
         UNION ALL SELECT i.id FROM images i JOIN down ON i.parent_id = down.id
       )
       SELECT images.* FROM images JOIN down USING (id) ORDER BY created_at`,
    )
    .all({ id }) as ImageRow[];
  return rows.map(toImage);
}

export function setFavorite(id: string, favorite: boolean) {
  db.prepare("UPDATE images SET favorite = ? WHERE id = ?").run(favorite ? 1 : 0, id);
}

/** Children of a deleted image are re-attached to its parent, so trees stay connected. */
export function deleteImage(id: string) {
  const files = [imagePath(id), mediaPath(id), lastFramePath(id)];
  const parent = (db.prepare("SELECT parent_id FROM images WHERE id = ?").get(id) as { parent_id: string | null } | undefined)
    ?.parent_id;
  db.transaction(() => {
    db.prepare("UPDATE images SET parent_id = ? WHERE parent_id = ?").run(parent ?? null, id);
    db.prepare("DELETE FROM images WHERE id = ?").run(id);
  })();
  for (const f of new Set(files)) if (f) fs.rmSync(f, { force: true });
  for (const f of fs.readdirSync(THUMB_DIR)) if (f.startsWith(`${id}_`)) fs.rmSync(path.join(THUMB_DIR, f), { force: true });
}

// ---- presets ---------------------------------------------------------------

interface PresetRow {
  id: string;
  name: string;
  family: string;
  purpose: string;
  content: string;
  builtin: number;
  updated_at: number;
}

const toPreset = (r: PresetRow): Preset => ({
  id: r.id,
  name: r.name,
  family: r.family as ModelFamily,
  purpose: r.purpose as PresetPurpose,
  content: r.content,
  builtin: r.builtin === 1,
  updatedAt: r.updated_at,
});

export function listPresets() {
  return (db.prepare("SELECT * FROM presets ORDER BY purpose, builtin DESC, name").all() as PresetRow[]).map(toPreset);
}

export function getPreset(id: string) {
  const r = db.prepare("SELECT * FROM presets WHERE id = ?").get(id) as PresetRow | undefined;
  return r ? toPreset(r) : undefined;
}

type PresetInput = { name: string; family: ModelFamily; purpose: PresetPurpose; content: string };

export function createPreset(p: PresetInput) {
  const id = nanoid(10);
  db.prepare(
    "INSERT INTO presets (id, name, family, purpose, content, builtin, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
  ).run(id, p.name, p.family, p.purpose, p.content, Date.now());
  return getPreset(id)!;
}

/** Built-in presets are read-only; returns undefined for them. */
export function updatePreset(id: string, p: PresetInput) {
  const res = db
    .prepare(
      "UPDATE presets SET name = ?, family = ?, purpose = ?, content = ?, updated_at = ? WHERE id = ? AND builtin = 0",
    )
    .run(p.name, p.family, p.purpose, p.content, Date.now(), id);
  return res.changes ? getPreset(id) : undefined;
}

export function deletePreset(id: string) {
  return db.prepare("DELETE FROM presets WHERE id = ? AND builtin = 0").run(id).changes > 0;
}
