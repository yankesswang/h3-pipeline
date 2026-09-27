import fs from "node:fs";
import path from "node:path";
import type { LoraInfo } from "@/lib/shared/types";
import { comfy } from "./comfy";
import { db } from "./db";

// LoRAs live in ComfyUI's loras folders; we only keep notes (trigger words)
// and a default strength for each, and show preview images found next to them.

const PREVIEW_EXTS = [".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp", ".png", ".jpg", ".jpeg", ".webp"];

async function loraDirs(): Promise<string[]> {
  const paths = (await fetch(`${comfy.baseUrl}/internal/folder_paths`).then((r) => r.json())) as Record<string, string[] | [string[], string[]]>;
  const raw = paths.loras ?? [];
  // Some ComfyUI versions return [paths, extensions].
  return (Array.isArray(raw[0]) ? raw[0] : raw) as string[];
}

export async function loraFolders() {
  return loraDirs();
}

export async function findPreview(name: string): Promise<string | undefined> {
  if (name.includes("..")) return undefined;
  const stem = name.replace(/\.[^./]+$/, "");
  for (const dir of await loraDirs())
    for (const ext of PREVIEW_EXTS) {
      const p = path.join(dir, stem + ext);
      if (fs.existsSync(p)) return p;
    }
  return undefined;
}

export async function listLoras(): Promise<LoraInfo[]> {
  const names = (await fetch(`${comfy.baseUrl}/models/loras`).then((r) => r.json())) as string[];
  const meta = new Map(
    (db.prepare("SELECT * FROM lora_meta").all() as { name: string; note: string; default_strength: number }[]).map((m) => [m.name, m]),
  );
  return Promise.all(
    names.map(async (name) => ({
      name,
      note: meta.get(name)?.note ?? "",
      defaultStrength: meta.get(name)?.default_strength ?? 1,
      hasPreview: !!(await findPreview(name)),
    })),
  );
}

export function saveLoraMeta(name: string, note: string, defaultStrength: number) {
  db.prepare(
    `INSERT INTO lora_meta (name, note, default_strength) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET note = excluded.note, default_strength = excluded.default_strength`,
  ).run(name, note, defaultStrength);
}
