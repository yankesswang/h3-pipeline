import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ImageRecord, ModelFamily, Preset } from "@/lib/shared/types";
import { db, IMAGE_DIR } from "./db";

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
}

function toImage(r: ImageRow): ImageRecord {
  return {
    id: r.id,
    tool: r.tool,
    params: JSON.parse(r.params),
    origin: r.origin ? JSON.parse(r.origin) : undefined,
    parentId: r.parent_id ?? undefined,
    width: r.width,
    height: r.height,
    favorite: r.favorite === 1,
    createdAt: r.created_at,
  };
}

export function insertImage(img: ImageRecord, png: Buffer): ImageRecord {
  const file = `${img.id}.png`;
  fs.writeFileSync(path.join(IMAGE_DIR, file), png);
  db.prepare(
    `INSERT INTO images (id, tool, params, origin, parent_id, width, height, file, favorite, created_at)
     VALUES (@id, @tool, @params, @origin, @parent_id, @width, @height, @file, 0, @created_at)`,
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

export function imagePath(id: string) {
  const r = db.prepare("SELECT file FROM images WHERE id = ?").get(id) as { file: string } | undefined;
  return r ? path.join(IMAGE_DIR, r.file) : undefined;
}

export function setFavorite(id: string, favorite: boolean) {
  db.prepare("UPDATE images SET favorite = ? WHERE id = ?").run(favorite ? 1 : 0, id);
}

export function deleteImage(id: string) {
  const p = imagePath(id);
  db.prepare("DELETE FROM images WHERE id = ?").run(id);
  if (p) fs.rmSync(p, { force: true });
}

// ---- presets ---------------------------------------------------------------

interface PresetRow {
  id: string;
  name: string;
  family: string;
  content: string;
  builtin: number;
  updated_at: number;
}

const toPreset = (r: PresetRow): Preset => ({
  id: r.id,
  name: r.name,
  family: r.family as ModelFamily,
  content: r.content,
  builtin: r.builtin === 1,
  updatedAt: r.updated_at,
});

export function listPresets() {
  return (db.prepare("SELECT * FROM presets ORDER BY builtin DESC, name").all() as PresetRow[]).map(toPreset);
}

export function getPreset(id: string) {
  const r = db.prepare("SELECT * FROM presets WHERE id = ?").get(id) as PresetRow | undefined;
  return r ? toPreset(r) : undefined;
}

export function createPreset(p: { name: string; family: ModelFamily; content: string }) {
  const id = nanoid(10);
  db.prepare("INSERT INTO presets (id, name, family, content, builtin, updated_at) VALUES (?, ?, ?, ?, 0, ?)").run(
    id,
    p.name,
    p.family,
    p.content,
    Date.now(),
  );
  return getPreset(id)!;
}

/** Built-in presets are read-only; returns undefined for them. */
export function updatePreset(id: string, p: { name: string; family: ModelFamily; content: string }) {
  const res = db
    .prepare("UPDATE presets SET name = ?, family = ?, content = ?, updated_at = ? WHERE id = ? AND builtin = 0")
    .run(p.name, p.family, p.content, Date.now(), id);
  return res.changes ? getPreset(id) : undefined;
}

export function deletePreset(id: string) {
  return db.prepare("DELETE FROM presets WHERE id = ? AND builtin = 0").run(id).changes > 0;
}
