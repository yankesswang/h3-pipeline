import type { AspectId } from "@/lib/shared/sizes";
import { randomSeed, sizeFor } from "@/lib/shared/sizes";
import { DEFAULT_VIDEO_SPEED, speedOf, VIDEO_SPEEDS, videoSize } from "@/lib/tools/video";
import type { GenerateParams, ImageRecord, LoraUse, PresetPurpose, PromptOrigin, VideoContext, VideoSpeed } from "@/lib/shared/types";

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

export interface VideoSettings {
  seconds: number;
  /** 0.4 fast, 0.98 = 768p. */
  megapixels: number;
  /** Image to video; absent = text to video at the chosen aspect. */
  first?: ImageRecord;
  /** Optional end frame (needs a first frame). */
  last?: ImageRecord;
  /** 4 or 8-step Turbo LoRA, or the base model. */
  speed: VideoSpeed;
  steps: number;
  sampler: string;
  scheduler: string;
}

export interface Size {
  width: number;
  height: number;
}

export interface ComposerState {
  prompt: string;
  negativePrompt: string;
  aspect: AspectId;
  megapixels: number;
  /** Set: exact width × height instead of aspect and megapixels. */
  customSize: Size | null;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  /** Editing only: below 1 keeps more of the source's structure. */
  denoise: number;
  seed: number;
  /** Unlocked: a fresh random seed every run. */
  seedLocked: boolean;
  count: number;
  /** Applied to both generating and editing. */
  loras: LoraUse[];
  origin?: PromptOrigin;
  /** Set: the composer edits this image instead of making a new one. */
  edit?: EditTarget;
  /** Make a video instead of an image. */
  mode: "image" | "video";
  video: VideoSettings;
}

export const initialComposer: ComposerState = {
  prompt: "",
  negativePrompt: "",
  aspect: "1:1",
  megapixels: 1,
  customSize: null,
  steps: 40,
  cfg: 1,
  sampler: "euler",
  scheduler: "simple",
  denoise: 1,
  seed: randomSeed(),
  seedLocked: false,
  count: 1,
  loras: [],
  mode: "image",
  video: { seconds: 3, megapixels: 0.4, speed: DEFAULT_VIDEO_SPEED, steps: VIDEO_SPEEDS[DEFAULT_VIDEO_SPEED].steps, sampler: "res_multistep", scheduler: "simple" },
};

export const purposeOf = (s: ComposerState): PresetPurpose =>
  s.mode === "video" ? "video" : s.edit ? "edit" : "generate";

const ASPECT_RATIOS: Record<string, [number, number]> = {
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "3:2": [3, 2],
  "2:3": [2, 3],
  "16:9": [16, 9],
  "9:16": [9, 16],
};

/** The video's size: the first frame's shape at the pixel budget, or the chosen aspect. */
export function videoDims(s: ComposerState) {
  const [aw, ah] = s.video.first ? [s.video.first.width, s.video.first.height] : ASPECT_RATIOS[s.aspect];
  return videoSize(s.video.megapixels, aw, ah);
}

/** What the LLM needs to know about the clip when writing a video prompt. */
export function videoContext(s: ComposerState): VideoContext | undefined {
  if (s.mode !== "video") return undefined;
  const { width, height } = videoDims(s);
  return { seconds: s.video.seconds, width, height };
}

/** A new image's size: the custom one, or the aspect at the pixel budget. */
export const imageSize = (s: ComposerState): Size => s.customSize ?? sizeFor(s.aspect, s.megapixels);

export function toParams(s: ComposerState): GenerateParams {
  if (s.mode === "video") {
    const v = s.video;
    return {
      prompt: s.prompt.trim(),
      negativePrompt: "",
      ...videoDims(s),
      steps: v.steps,
      cfg: 1,
      seed: s.seedLocked ? s.seed : randomSeed(),
      sampler: v.sampler,
      scheduler: v.scheduler,
      video: {
        seconds: v.seconds,
        megapixels: v.megapixels,
        firstFrameId: v.first?.id,
        lastFrameId: v.first ? v.last?.id : undefined,
        speed: v.speed,
      },
    };
  }
  const o = s.edit?.outpaint ?? NO_PADS;
  const size = s.edit
    ? { width: s.edit.source.width + o.left + o.right, height: s.edit.source.height + o.top + o.bottom }
    : imageSize(s);
  return {
    prompt: s.prompt.trim(),
    negativePrompt: s.negativePrompt,
    ...size,
    steps: s.steps,
    cfg: s.cfg,
    seed: s.seedLocked ? s.seed : randomSeed(),
    sampler: s.sampler,
    scheduler: s.scheduler,
    ...(s.edit && s.denoise < 1 ? { denoise: s.denoise } : {}),
    ...(s.edit ? { sourceImageId: s.edit.source.id, refImageIds: s.edit.refs.map((r) => r.id) } : {}),
    ...(s.edit && hasPads(s.edit.outpaint) ? { outpaint: s.edit.outpaint } : {}),
    ...(s.loras.length ? { loras: s.loras } : {}),
  };
}

/** Image ids in <imageN> order, for the LLM to look at. */
export const editImageIds = (s: ComposerState) =>
  s.mode === "video"
    ? [s.video.first?.id, s.video.last?.id].filter((x): x is string => !!x)
    : s.edit
      ? [s.edit.source.id, ...s.edit.refs.map((r) => r.id)]
      : [];

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
  const preset = sizeFor(aspect, megapixels);
  const source = p.sourceImageId ? lookup(p.sourceImageId) : undefined;
  if (p.video)
    return {
      ...initialComposer,
      prompt: p.prompt,
      aspect,
      seed: p.seed,
      seedLocked: lockSeed,
      origin: img.origin,
      mode: "video",
      video: {
        seconds: p.video.seconds,
        megapixels: p.video.megapixels,
        speed: speedOf(p.video),
        steps: p.steps || VIDEO_SPEEDS[speedOf(p.video)].steps,
        sampler: p.sampler ?? initialComposer.video.sampler,
        scheduler: p.scheduler ?? initialComposer.video.scheduler,
        first: p.video.firstFrameId ? lookup(p.video.firstFrameId) : undefined,
        last: p.video.lastFrameId ? lookup(p.video.lastFrameId) : undefined,
      },
    };
  return {
    prompt: p.prompt,
    negativePrompt: p.negativePrompt,
    aspect,
    megapixels,
    customSize: preset.width === p.width && preset.height === p.height ? null : { width: p.width, height: p.height },
    steps: p.steps || 40,
    cfg: p.cfg || 1,
    sampler: p.sampler ?? initialComposer.sampler,
    scheduler: p.scheduler ?? initialComposer.scheduler,
    denoise: p.denoise ?? 1,
    seed: p.seed,
    seedLocked: lockSeed,
    count: 1,
    loras: p.loras ?? [],
    mode: "image",
    video: initialComposer.video,
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
    mode: "image",
    prompt: keepText ? s.prompt : "",
    origin: keepText ? s.origin : undefined,
    edit: { source: img, refs: s.edit?.refs.filter((r) => r.id !== img.id) ?? [] },
  };
}

/** Switch between making images and videos; an image being edited becomes the video's first frame. */
export function setMode(s: ComposerState, mode: "image" | "video"): ComposerState {
  if (mode === s.mode) return s;
  if (mode === "video")
    return { ...s, mode, prompt: "", origin: undefined, edit: undefined, video: { ...s.video, first: s.edit?.source ?? s.video.first } };
  return { ...s, mode, prompt: "", origin: undefined };
}

/** Start a video from this image (image to video). */
export function startVideo(s: ComposerState, first: ImageRecord): ComposerState {
  return { ...s, mode: "video", edit: undefined, prompt: s.mode === "video" ? s.prompt : "", video: { ...s.video, first, last: undefined } };
}

export function addRefs(s: ComposerState, imgs: ImageRecord[]): ComposerState {
  if (!s.edit) return s;
  const have = new Set([s.edit.source.id, ...s.edit.refs.map((r) => r.id)]);
  const refs = [...s.edit.refs, ...imgs.filter((i) => !have.has(i.id))].slice(0, MAX_REFS);
  return { ...s, edit: { ...s.edit, refs } };
}
