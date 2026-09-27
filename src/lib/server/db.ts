import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { BUILTIN_PRESETS } from "./presets-builtin";

export const DATA_DIR = process.env.STUDIO_DATA_DIR ?? path.join(process.cwd(), "data");
export const IMAGE_DIR = path.join(DATA_DIR, "images");

function open() {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
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
  // Built-in presets are refreshed on every start; users edit copies of them.
  const upsert = db.prepare(
    `INSERT INTO presets (id, name, family, content, builtin, updated_at) VALUES (?, ?, ?, ?, 1, 0)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, family = excluded.family, content = excluded.content`,
  );
  for (const p of BUILTIN_PRESETS) upsert.run(p.id, p.name, p.family, p.content);
  return db;
}

// Survive Next.js dev hot reloads without opening the file twice.
const g = globalThis as unknown as { __studioDb?: Database.Database };
export const db = (g.__studioDb ??= open());
