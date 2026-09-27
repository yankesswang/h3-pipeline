import type { AspectId } from "@/lib/shared/sizes";
import { randomSeed, sizeFor } from "@/lib/shared/sizes";
import type { GenerateParams, ImageRecord, PresetPurpose, PromptOrigin } from "@/lib/shared/types";

export interface Pads {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const NO_PADS: Pads = { left: 0, top: 0, right: 0, bottom: 0 };
export const hasPads = (p?: Pads) => !!p && p.left + p.top + p.right + p.bottom > 0;

export interface EditTarget {
  /** The image being changed: <image1>. */
  source: ImageRecord;
  /** Reference images: <image2> onwards. */
  refs: ImageRecord[];
  /** Set while outpainting: how far to grow each side, in source pixels. */
  outpaint?: Pads;
}

export const MAX_REFS = 9;

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
  /** Set: the composer edits this image instead of making a new one. */
  edit?: EditTarget;
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

export const purposeOf = (s: ComposerState): PresetPurpose => (s.edit ? "edit" : "generate");

export function toParams(s: ComposerState): GenerateParams {
  const o = s.edit?.outpaint ?? NO_PADS;
  const size = s.edit
    ? { width: s.edit.source.width + o.left + o.right, height: s.edit.source.height + o.top + o.bottom }
    : sizeFor(s.aspect, s.megapixels);
  return {
    prompt: s.prompt.trim(),
    negativePrompt: s.negativePrompt,
    ...size,
    steps: s.steps,
    cfg: s.cfg,
    seed: s.seedLocked ? s.seed : randomSeed(),
    ...(s.edit ? { sourceImageId: s.edit.source.id, refImageIds: s.edit.refs.map((r) => r.id) } : {}),
    ...(s.edit && hasPads(s.edit.outpaint) ? { outpaint: s.edit.outpaint } : {}),
  };
}

/** Image ids in <imageN> order, for the LLM to look at. */
export const editImageIds = (s: ComposerState) => (s.edit ? [s.edit.source.id, ...s.edit.refs.map((r) => r.id)] : []);

/**
 * Load an image's settings back into the composer (reuse / remix). For an edit,
 * `lookup` resolves its source and references; if they are gone it falls back to a plain prompt.
 */
export function fromImage(
  img: ImageRecord,
  lockSeed: boolean,
  lookup: (id: string) => ImageRecord | undefined,
): ComposerState {
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
  const source = p.sourceImageId ? lookup(p.sourceImageId) : undefined;
  return {
    prompt: p.prompt,
    negativePrompt: p.negativePrompt,
    aspect,
    megapixels,
    steps: p.steps || 40,
    cfg: p.cfg || 1,
    seed: p.seed,
    seedLocked: lockSeed,
    count: 1,
    origin: img.origin,
    edit: source
      ? {
          source,
          refs: (p.refImageIds ?? []).map(lookup).filter((r): r is ImageRecord => !!r),
          outpaint: p.outpaint,
        }
      : undefined,
  };
}

/** Pads that grow the image to an aspect ratio, split evenly on both sides. */
export function padsForAspect(w: number, h: number, ratio: number): Pads {
  const snap = (v: number) => Math.round(v / 16) * 16;
  if (w / h < ratio) {
    const extra = snap(h * ratio - w);
    return { left: snap(extra / 2), right: extra - snap(extra / 2), top: 0, bottom: 0 };
  }
  const extra = snap(w / ratio - h);
  return { top: snap(extra / 2), bottom: extra - snap(extra / 2), left: 0, right: 0 };
}

/** Start editing `img`, keeping the rest of the composer (quality, count...). */
export function startEdit(s: ComposerState, img: ImageRecord): ComposerState {
  const keepText = s.edit !== undefined; // an instruction in progress still applies to the new target
  return {
    ...s,
    prompt: keepText ? s.prompt : "",
    origin: keepText ? s.origin : undefined,
    edit: { source: img, refs: s.edit?.refs.filter((r) => r.id !== img.id) ?? [] },
  };
}

export function addRefs(s: ComposerState, imgs: ImageRecord[]): ComposerState {
  if (!s.edit) return s;
  const have = new Set([s.edit.source.id, ...s.edit.refs.map((r) => r.id)]);
  const refs = [...s.edit.refs, ...imgs.filter((i) => !have.has(i.id))].slice(0, MAX_REFS);
  return { ...s, edit: { ...s.edit, refs } };
}
