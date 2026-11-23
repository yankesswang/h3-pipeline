import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import type { BatchRequest, FolderListing, Job } from "@/lib/shared/types";
import { importUpload } from "./images";
import { cancel, enqueue, listJobs } from "./queue";
import { getImage } from "./repo";

// Batch edit: the same instruction applied to every image in a folder (or a
// gallery selection), like the ComfyUI "batch edit" workflow with its
// LoadImagesFromPath node. Each image becomes its own qwen21-edit job, so
// results land in the gallery with the original as their parent.

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const MAX_IMAGES = 200;
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** `~` works for the home folder, as in ComfyUI's node. */
export function resolveDir(p: string) {
  const t = p.trim();
  if (!t) return os.homedir();
  return path.resolve(t === "~" ? os.homedir() : t.startsWith("~/") ? path.join(os.homedir(), t.slice(2)) : t);
}

export function listFolder(p: string): FolderListing {
  const dir = resolveDir(p);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new Error(`打不開資料夾 ${dir}`);
  }
  const visible = entries.filter((e) => !e.name.startsWith("."));
  const parent = path.dirname(dir);
  return {
    path: dir,
    parent: parent === dir ? undefined : parent,
    dirs: visible.filter((e) => e.isDirectory()).map((e) => e.name).sort(byName),
    images: visible.filter((e) => e.isFile() && IMAGE_EXT.test(e.name)).map((e) => e.name).sort(byName),
  };
}

export async function startBatch(req: BatchRequest): Promise<Job[]> {
  const p = req.params;
  if (!p?.prompt?.trim()) throw new Error("修圖指令不能是空的");

  let sources: { id: string; name?: string }[];
  if (req.folder !== undefined) {
    const { path: dir, images } = listFolder(req.folder);
    if (!images.length) throw new Error(`${dir} 裡沒有 PNG / JPG / WEBP 圖片`);
    if (images.length > MAX_IMAGES) throw new Error(`一次最多 ${MAX_IMAGES} 張，這個資料夾有 ${images.length} 張`);
    sources = [];
    for (const name of images) {
      const img = await importUpload(fs.readFileSync(path.join(dir, name)), name).catch(() => undefined);
      if (img) sources.push({ id: img.id, name: name.replace(/\.[^.]+$/, "") });
    }
    if (!sources.length) throw new Error("這些圖片都讀不了");
  } else {
    const ids = [...new Set(req.imageIds ?? [])];
    if (!ids.length) throw new Error("請選擇要修改的圖片");
    if (ids.length > MAX_IMAGES) throw new Error(`一次最多 ${MAX_IMAGES} 張`);
    const missing = ids.find((id) => !getImage(id));
    if (missing) throw new Error(`找不到圖片 ${missing}`);
    sources = ids.map((id) => ({ id }));
  }

  let saveTo: string | undefined;
  if (req.saveTo?.trim()) {
    saveTo = resolveDir(req.saveTo);
    try {
      fs.mkdirSync(saveTo, { recursive: true });
      fs.accessSync(saveTo, fs.constants.W_OK);
    } catch {
      throw new Error(`無法寫入 ${saveTo}`);
    }
  }

  const id = nanoid(8);
  // One seed for the whole batch, so every image gets the same treatment.
  return sources.map((s, index) =>
    enqueue("qwen21-edit", {
      ...p,
      sourceImageId: s.id,
      refImageIds: undefined,
      maskId: undefined,
      outpaint: undefined,
      batch: { id, index, total: sources.length, name: s.name, saveTo },
    }, req.origin),
  );
}

/** Cancel what is left of a batch: queued jobs are dropped, the running one is interrupted. */
export async function cancelBatch(id: string) {
  const left = listJobs().filter((j) => j.params.batch?.id === id && (j.status === "queued" || j.status === "running"));
  // Queued first, so the queue does not start the next one after the interrupt.
  left.sort((a, b) => (a.status === "queued" ? -1 : 1) - (b.status === "queued" ? -1 : 1));
  for (const j of left) await cancel(j.id);
  return left.length;
}

/**
 * Ask the desktop for a folder with the system's own picker (zenity). It opens
 * on this machine's screen, so it only helps when the browser is here too.
 * Resolves to undefined when the dialog is cancelled.
 */
export function pickFolder(start: string): Promise<string | undefined> {
  const dir = resolveDir(start);
  return new Promise((resolve, reject) => {
    execFile(
      "zenity",
      ["--file-selection", "--directory", "--title=選擇要批次修圖的資料夾", `--filename=${dir}/`],
      { env: { ...process.env, DISPLAY: process.env.DISPLAY || ":1" }, timeout: 10 * 60_000 },
      (err, stdout) => {
        if (!err) return resolve(stdout.trim() || undefined);
        // zenity exits 1 on cancel; anything else means no dialog could be shown.
        if ((err as { code?: unknown }).code === 1) return resolve(undefined);
        reject(new Error("無法開啟選擇資料夾的視窗，請直接輸入路徑"));
      },
    );
  });
}
