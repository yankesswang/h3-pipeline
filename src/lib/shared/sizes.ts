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

/** Custom sizes: any multiple of 32 in this range (Qwen Image 2.1 is native up to 4 MP). */
export const CUSTOM_SIZE = { min: 256, max: 3072, step: 32 } as const;

export const snapSize = (n: number) =>
  Math.min(CUSTOM_SIZE.max, Math.max(CUSTOM_SIZE.min, Math.round(n / CUSTOM_SIZE.step) * CUSTOM_SIZE.step));

/** Video pixel budgets, from the official H3 table; 0.98 is the native 768p (short edge capped at 768). */
export const VIDEO_MEGAPIXELS = [0.2, 0.4, 0.6, 0.8, 0.98] as const;

// A curated subset of ComfyUI's samplers; the official paths use euler (image) and res_multistep (video).
export const SAMPLERS = [
  "euler",
  "euler_ancestral",
  "heun",
  "dpmpp_2m",
  "dpmpp_2m_sde",
  "dpmpp_3m_sde",
  "dpmpp_sde",
  "res_multistep",
  "er_sde",
  "sa_solver",
  "uni_pc",
  "deis",
  "ddim",
  "lcm",
] as const;

export const SCHEDULERS = [
  "simple",
  "beta",
  "normal",
  "karras",
  "exponential",
  "sgm_uniform",
  "linear_quadratic",
  "kl_optimal",
  "ddim_uniform",
] as const;

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 48);
}
