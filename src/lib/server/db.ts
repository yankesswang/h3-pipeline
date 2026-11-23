import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { BUILTIN_PRESETS } from "./presets-builtin";

export const DATA_DIR = process.env.STUDIO_DATA_DIR ?? path.join(process.cwd(), "data");
export const IMAGE_DIR = path.join(DATA_DIR, "images");
export const THUMB_DIR = path.join(DATA_DIR, "thumbs");
export const MASK_DIR = path.join(DATA_DIR, "masks");

function open() {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  fs.mkdirSync(MASK_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "studio.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      params TEXT NOT NULL,
      origin TEXT,
      parent_id TEXT,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      file TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS images_created ON images(created_at DESC);
    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      family TEXT NOT NULL,
      content TEXT NOT NULL,
      builtin INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  migrate(db);
  // Built-in presets are refreshed on every start, unless the user edited them (updated_at > 0).
  const upsert = db.prepare(
    `INSERT INTO presets (id, name, family, purpose, content, builtin, updated_at) VALUES (?, ?, ?, ?, ?, 1, 0)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, family = excluded.family,
       purpose = excluded.purpose, content = excluded.content
     WHERE presets.updated_at = 0`,
  );
  for (const p of BUILTIN_PRESETS) upsert.run(p.id, p.name, p.family, p.purpose, p.content);
  return db;
}

function migrate(db: Database.Database) {
  const cols = (table: string) =>
    new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  if (!cols("presets").has("purpose"))
    db.exec("ALTER TABLE presets ADD COLUMN purpose TEXT NOT NULL DEFAULT 'generate'");
  db.exec("CREATE INDEX IF NOT EXISTS images_parent ON images(parent_id)");
  if (!cols("images").has("media")) {
    db.exec("ALTER TABLE images ADD COLUMN media TEXT NOT NULL DEFAULT 'image'");
    db.exec("ALTER TABLE images ADD COLUMN duration REAL");
  }
  // Uploads are found again by the SHA-256 of their pixels, so the same picture is stored once.
  if (!cols("images").has("hash")) db.exec("ALTER TABLE images ADD COLUMN hash TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS images_hash ON images(hash)");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      workflow TEXT NOT NULL,
      fields TEXT NOT NULL,
      output_node TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lora_meta (
      name TEXT PRIMARY KEY,
      note TEXT NOT NULL DEFAULT '',
      default_strength REAL NOT NULL DEFAULT 1
    );
  `);
}

// Survive Next.js dev hot reloads without opening the file twice.
const g = globalThis as unknown as { __studioDb?: Database.Database };
export const db = (g.__studioDb ??= open());
