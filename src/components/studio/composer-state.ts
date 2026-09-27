import type { AspectId } from "@/lib/shared/sizes";
import { randomSeed, sizeFor } from "@/lib/shared/sizes";
import type { GenerateParams, ImageRecord, PromptOrigin } from "@/lib/shared/types";

export interface ComposerState {
  prompt: string;
  negativePrompt: string;
  aspect: AspectId;
  megapixels: number;
  steps: number;
  cfg: number;
  seed: number;
  /** Unlocked: a fresh random seed every run. */
  seedLocked: boolean;
  count: number;
  origin?: PromptOrigin;
}

export const initialComposer: ComposerState = {
  prompt: "",
  negativePrompt: "",
  aspect: "1:1",
  megapixels: 1,
  steps: 40,
  cfg: 1,
  seed: randomSeed(),
  seedLocked: false,
  count: 1,
};

export function toParams(s: ComposerState): GenerateParams {
  const { width, height } = sizeFor(s.aspect, s.megapixels);
  return {
    prompt: s.prompt.trim(),
    negativePrompt: s.negativePrompt,
    width,
    height,
    steps: s.steps,
    cfg: s.cfg,
    seed: s.seedLocked ? s.seed : randomSeed(),
  };
}

/** Load an image's settings back into the composer (reuse / remix). */
export function fromImage(img: ImageRecord, lockSeed: boolean): ComposerState {
  const p = img.params;
  const ratio = p.width / p.height;
  const aspects: [AspectId, number][] = [
    ["1:1", 1],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["3:2", 3 / 2],
    ["2:3", 2 / 3],
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
  ];
  const aspect = aspects.reduce((best, a) => (Math.abs(a[1] - ratio) < Math.abs(best[1] - ratio) ? a : best))[0];
  const mp = (p.width * p.height) / (1024 * 1024);
  const megapixels = [1, 2, 4].reduce((b, m) => (Math.abs(m - mp) < Math.abs(b - mp) ? m : b));
  return {
    prompt: p.prompt,
    negativePrompt: p.negativePrompt,
    aspect,
    megapixels,
    steps: p.steps,
    cfg: p.cfg,
    seed: p.seed,
    seedLocked: lockSeed,
    count: 1,
    origin: img.origin,
  };
}
