import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import type { ImageRecord } from "@/lib/shared/types";
import { THUMB_DIR } from "./db";
import { imagePath, insertImage } from "./repo";

// Qwen Image 2.1 works up to about 4 MP; bigger uploads are scaled down on the
// way in so edits stay fast and fit in VRAM.
const MAX_PIXELS = 2048 * 2048;

export async function importUpload(data: Buffer, name?: string): Promise<ImageRecord> {
  let img = sharp(data, { failOn: "none" }).rotate(); // apply EXIF orientation
  const meta = await img.metadata();
  let width = meta.autoOrient?.width ?? meta.width ?? 0;
  let height = meta.autoOrient?.height ?? meta.height ?? 0;
  if (!width || !height) throw new Error("看不懂這個圖片檔");
  if (width * height > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / (width * height));
    width = Math.floor(width * scale);
    height = Math.floor(height * scale);
    img = img.resize(width, height);
  }
  const png = await img.png().toBuffer();
  return insertImage(
    {
      id: nanoid(12),
      tool: "upload",
      media: "image",
      params: { prompt: name ? `上傳：${name}` : "上傳的圖片", negativePrompt: "", width, height, steps: 0, cfg: 0, seed: 0 },
      width,
      height,
      favorite: false,
      createdAt: Date.now(),
    },
    png,
  );
}

/** Pixel size straight from a PNG header, without decoding. */
export function pngSize(png: Buffer) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** A cached WebP thumbnail `width` pixels wide. */
export async function thumbnail(id: string, width: number): Promise<Buffer | undefined> {
  const file = path.join(THUMB_DIR, `${id}_${width}.webp`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const src = imagePath(id);
  if (!src || !fs.existsSync(src)) return undefined;
  const buf = await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  fs.writeFileSync(file, buf);
  return buf;
}

/** A small JPEG data URL for vision LLMs; they gain nothing from full resolution. */
export async function visionDataUrl(id: string): Promise<string> {
  const src = imagePath(id);
  if (!src) throw new Error(`找不到圖片 ${id}`);
  const buf = await sharp(src).resize(768, 768, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#fff" }).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}
