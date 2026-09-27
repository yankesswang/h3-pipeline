export const ASPECTS = [
  { id: "1:1", w: 1, h: 1 },
  { id: "4:3", w: 4, h: 3 },
  { id: "3:4", w: 3, h: 4 },
  { id: "3:2", w: 3, h: 2 },
  { id: "2:3", w: 2, h: 3 },
  { id: "16:9", w: 16, h: 9 },
  { id: "9:16", w: 9, h: 16 },
] as const;

export type AspectId = (typeof ASPECTS)[number]["id"];

// Qwen Image 2.1 works natively from 1 MP up to 4 MP (2048x2048).
export const MEGAPIXELS = [
  { id: 1, label: "標準 1MP" },
  { id: 2, label: "高 2MP" },
  { id: 4, label: "2K 4MP" },
] as const;

export const QUALITIES = [
  { id: "fast", label: "快速", steps: 25 },
  { id: "standard", label: "標準", steps: 40 },
  { id: "best", label: "精緻", steps: 50 },
] as const;

const round32 = (n: number) => Math.max(256, Math.round(n / 32) * 32);

export function sizeFor(aspect: AspectId, megapixels: number) {
  const a = ASPECTS.find((x) => x.id === aspect) ?? ASPECTS[0];
  const pixels = megapixels * 1024 * 1024;
  const width = round32(Math.sqrt((pixels * a.w) / a.h));
  const height = round32(width * (a.h / a.w));
  return { width, height };
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 48);
}
