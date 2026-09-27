import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { MASK_DIR } from "./db";

/** Save a selection sent from the browser (PNG data URL); returns its id. */
export function saveMask(dataUrl: string): string {
  const m = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!m) throw new Error("遮罩格式不對");
  const id = nanoid(12);
  fs.writeFileSync(path.join(MASK_DIR, `${id}.png`), Buffer.from(m[1], "base64"));
  return id;
}

export function maskPath(id: string) {
  if (!/^[\w-]+$/.test(id)) throw new Error("bad mask id");
  const p = path.join(MASK_DIR, `${id}.png`);
  if (!fs.existsSync(p)) throw new Error("找不到選取範圍");
  return p;
}
