import sharp, { type Sharp } from "sharp";

// Qwen Image 2.1's edit mode has no mask input, so local edits and outpainting
// are done around it:
//  - masked edit: crop the masked area with some context, let the model edit
//    the crop, then paste only the masked part back with a feathered edge;
//  - outpaint: put the image on a bigger canvas, let the model fill the new
//    area, then lay the untouched original back over the middle.
// Either way, pixels outside the edit stay exactly as they were.

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Pads {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const MODEL_PIXELS = 1024 * 1024;
const MAX_PIXELS = 2048 * 2048;

/** Bounding box of the white (>127) pixels of a single-channel mask. */
async function maskBounds(mask: Buffer): Promise<{ rect: Rect; width: number; height: number } | undefined> {
  const { data, info } = await sharp(mask).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width,
    y0 = info.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < info.height; y++) {
    const row = y * info.width;
    for (let x = 0; x < info.width; x++) {
      if (data[row + x] > 127) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return undefined;
  return { rect: { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }, width: info.width, height: info.height };
}

/** Grow a rect by some context around it, kept inside the image and at least `min` on each side. */
function withContext(r: Rect, imgW: number, imgH: number): Rect {
  const pad = Math.max(48, Math.round(0.35 * Math.max(r.width, r.height)));
  const min = Math.min(384, imgW, imgH);
  let left = r.left - pad,
    top = r.top - pad,
    right = r.left + r.width + pad,
    bottom = r.top + r.height + pad;
  const grow = (a: number, b: number, size: number, limit: number): [number, number] => {
    if (b - a < size) {
      const extra = size - (b - a);
      a -= Math.floor(extra / 2);
      b += Math.ceil(extra / 2);
    }
    if (a < 0) [a, b] = [0, b - a];
    if (b > limit) [a, b] = [Math.max(0, a - (b - limit)), limit];
    return [a, b];
  };
  [left, right] = grow(left, right, min, imgW);
  [top, bottom] = grow(top, bottom, min, imgH);
  return { left, top, width: right - left, height: bottom - top };
}

/** Scale that brings an area to about one megapixel, the size the model works best at. */
function modelScale(w: number, h: number) {
  return Math.min(4, Math.max(0.25, Math.sqrt(MODEL_PIXELS / (w * h))));
}

export async function prepareMasked(source: Buffer, mask: Buffer) {
  const meta = await sharp(source).metadata();
  const W = meta.width!,
    H = meta.height!;
  // One clean channel: transparent counts as unselected.
  const fitted = await sharp(mask)
    .flatten({ background: "#000" })
    .greyscale()
    .extractChannel(0)
    .resize(W, H, { fit: "fill" })
    .png()
    .toBuffer();
  const bounds = await maskBounds(fitted);
  if (!bounds) throw new Error("選取範圍是空的");
  const rect = withContext(bounds.rect, W, H);
  const s = modelScale(rect.width, rect.height);
  const crop = await sharp(source)
    .extract(rect)
    .resize(Math.round(rect.width * s), Math.round(rect.height * s), { kernel: "lanczos3" })
    .png()
    .toBuffer();
  return { crop, rect, mask: fitted };
}

export async function stitchMasked(source: Buffer, result: Buffer, rect: Rect, mask: Buffer) {
  const feather = Math.max(4, Math.round(0.025 * Math.min(rect.width, rect.height)));
  // Grow the selection slightly, then soften it, so the seam lands just outside what was selected.
  const alpha = await sharp(mask)
    .extract(rect)
    .blur(feather)
    .threshold(24)
    .blur(feather)
    .extractChannel(0)
    .raw()
    .toBuffer();
  const patch = await withAlpha(
    sharp(result).resize(rect.width, rect.height, { fit: "fill", kernel: "lanczos3" }),
    alpha,
    rect.width,
    rect.height,
  );
  return sharp(source).composite([{ input: patch, left: rect.left, top: rect.top }]).png().toBuffer();
}

/**
 * The canvas the model fills: the original in the middle, the new area gray.
 * Canvases over 4 MP are scaled down for the model; `stitchOutpaint` scales back.
 */
export async function prepareOutpaint(source: Buffer, pads: Pads) {
  const meta = await sharp(source).metadata();
  const W = meta.width! + pads.left + pads.right;
  const H = meta.height! + pads.top + pads.bottom;
  if (W * H > MAX_PIXELS * 1.5) throw new Error("擴展後太大了，請縮小一點（上限約 6MP）");
  const canvas = await sharp(source)
    .removeAlpha()
    .extend({ ...pads, background: { r: 128, g: 128, b: 128 } })
    .png()
    .toBuffer();
  const s = Math.min(1, Math.sqrt(MAX_PIXELS / (W * H)));
  const forModel = s < 1 ? await sharp(canvas).resize(Math.round(W * s), Math.round(H * s)).png().toBuffer() : canvas;
  return { canvas: forModel, width: W, height: H };
}

export async function stitchOutpaint(source: Buffer, result: Buffer, pads: Pads, width: number, height: number) {
  const meta = await sharp(source).metadata();
  const w = meta.width!,
    h = meta.height!;
  // The original goes back on top, fading out over a few pixels on the sides that were extended.
  const fade = Math.max(6, Math.round(0.02 * Math.min(w, h)));
  const inset = {
    left: pads.left ? fade : 0,
    top: pads.top ? fade : 0,
    right: pads.right ? fade : 0,
    bottom: pads.bottom ? fade : 0,
  };
  const solid = Buffer.alloc(w * h);
  for (let y = inset.top; y < h - inset.bottom; y++) solid.fill(255, y * w + inset.left, y * w + w - inset.right);
  const inner = await sharp(solid, { raw: { width: w, height: h, channels: 1 } })
    .blur(fade / 2)
    .extractChannel(0)
    .raw()
    .toBuffer();
  const original = await withAlpha(sharp(source), inner, w, h);
  return sharp(result)
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .composite([{ input: original, left: pads.left, top: pads.top }])
    .png()
    .toBuffer();
}

/**
 * An RGBA PNG from any image plus a separate alpha buffer. Done by hand because
 * sharp runs removeAlpha() after joinChannel() whatever the call order.
 */
async function withAlpha(image: Sharp, alpha: Buffer, width: number, height: number) {
  const rgb = await image.removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = alpha[i];
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export const DEFAULT_OUTPAINT_PROMPT =
  "Fill the flat gray areas around the picture with a natural, seamless continuation of the scene, matching its content, perspective, lighting and style. Keep the existing picture unchanged.";
