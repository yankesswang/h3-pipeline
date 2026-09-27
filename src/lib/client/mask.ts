// The selection lives in an offscreen canvas at the source image's full size:
// opaque white where selected, transparent elsewhere.

export function createMask(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

export function maskIsEmpty(mask: HTMLCanvasElement) {
  const data = mask.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, mask.width, mask.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 127) return false;
  return true;
}

/** Replace the selection with a black/white mask image (e.g. from SAM). */
export async function loadMask(mask: HTMLCanvasElement, src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const ctx = mask.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, mask.width, mask.height);
  ctx.drawImage(img, 0, 0, mask.width, mask.height);
  const d = ctx.getImageData(0, 0, mask.width, mask.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const on = d.data[i] > 127;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
    d.data[i + 3] = on ? 255 : 0;
  }
  ctx.putImageData(d, 0, 0);
}

export function invertMask(mask: HTMLCanvasElement) {
  const ctx = mask.getContext("2d", { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, mask.width, mask.height);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
    d.data[i + 3] = d.data[i + 3] > 127 ? 0 : 255;
  }
  ctx.putImageData(d, 0, 0);
}

export function clearMask(mask: HTMLCanvasElement) {
  mask.getContext("2d", { willReadFrequently: true })!.clearRect(0, 0, mask.width, mask.height);
}

/** The PNG the server expects: white = change, black = keep. */
export function exportMask(mask: HTMLCanvasElement) {
  const out = createMask(mask.width, mask.height);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(mask, 0, 0);
  return out.toDataURL("image/png");
}
