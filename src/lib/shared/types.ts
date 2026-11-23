// Types shared by the server (API routes) and the browser.

export type ModelFamily = "qwen-image" | "flux" | "sdxl" | "generic";

export const FAMILY_LABELS: Record<ModelFamily, string> = {
  "qwen-image": "Qwen-Image（自然語言）",
  flux: "Flux（自然語言）",
  sdxl: "SDXL / Illustrious（tag）",
  generic: "通用",
};

/** What a preset writes: prompts for new images, instructions for editing one, or video prompts. */
export type PresetPurpose = "generate" | "edit" | "video";

export const PURPOSE_LABELS: Record<PresetPurpose, string> = {
  generate: "生成新圖",
  edit: "修圖指令",
  video: "影片",
};

export interface Preset {
  id: string;
  name: string;
  family: ModelFamily;
  purpose: PresetPurpose;
  content: string;
  builtin: boolean;
  updatedAt: number;
}

export interface GenerateParams {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  /** Sampler and scheduler names; absent = the tool's default. */
  sampler?: string;
  scheduler?: string;
  /** Editing: how much of the source is re-drawn (below 1 keeps more of its structure); absent = 1. */
  denoise?: number;
  /** Editing: the image being changed (it becomes <image1>). */
  sourceImageId?: string;
  /** Editing: extra reference images, <image2> onwards. */
  refImageIds?: string[];
  /** Editing: only change the selected area (a saved mask, white = change). */
  maskId?: string;
  /** Editing: grow the canvas by these many pixels and fill the new area. */
  outpaint?: { left: number; top: number; right: number; bottom: number };
  /** LoRAs applied on top of the model, in order. */
  loras?: LoraUse[];
  /** Imported-workflow tools: every field's value, keyed by field key. Image fields hold image ids. */
  toolValues?: Record<string, unknown>;
  /** Video generation settings. */
  video?: VideoParams;
  /** Editing: pixel budget each input is resized to (1024 ≈ 1 MP); 0 or absent keeps their own size. */
  resolution?: number;
  /** Set when the job is one image of a batch edit. */
  batch?: BatchInfo;
}

/** One image of a batch: the same edit applied to many images. */
export interface BatchInfo {
  id: string;
  /** 0-based position in the batch. */
  index: number;
  total: number;
  /** The original file name, for images read from a folder. */
  name?: string;
  /** Also write the result to this folder as `<name>.png`. */
  saveTo?: string;
}

export interface BatchRequest {
  /** A folder on this machine; every PNG / JPG / WEBP in it, in file name order. */
  folder?: string;
  /** Or images already in the gallery. */
  imageIds?: string[];
  params: GenerateParams;
  saveTo?: string;
  /** Where the instruction came from (an LLM expansion), kept on every result. */
  origin?: PromptOrigin;
}

export interface FolderListing {
  path: string;
  parent?: string;
  dirs: string[];
  images: string[];
}

export interface VideoParams {
  seconds: number;
  /** Pixel budget: 0.4 is fast, 0.98 is the official 768p. */
  megapixels: number;
  /** Image to video: the first frame (an image id). Absent = text to video at width × height. */
  firstFrameId?: string;
  /** Optional end frame the video moves towards. */
  lastFrameId?: string;
  /** Images the clip passes through in between (needs a first frame), in time order. */
  keyframes?: VideoKeyframe[];
  /** Which speed-up LoRA runs, if any. Absent: older clips, see `turbo`. */
  speed?: VideoSpeed;
  /** Older clips: false = base model, otherwise the 8-step Turbo LoRA. */
  turbo?: boolean;
}

/** pi-H3 2 or 4-step DWD adapter, 4 or 8-step Turbo LoRA, or the base model at about 20 steps. */
export type VideoSpeed = "pi2" | "pi4" | "turbo4" | "turbo8" | "base";

export interface VideoKeyframe {
  imageId: string;
  /** Seconds from the start. */
  at: number;
}

/** What the LLM is told about a video clip, so it can pace the action and read the attached frames right. */
export interface VideoContext {
  seconds: number;
  /** Text to video: the clip's size. */
  width?: number;
  height?: number;
  /** Seconds of the keyframes attached between the first frame and the end frame. */
  keyframes?: number[];
}

export interface LoraUse {
  name: string;
  strength: number;
}

export type BuiltinToolId = "qwen21-t2i" | "qwen21-edit" | "minimax-h3-video";
/** Built-in tools, or `custom:<id>` for an imported workflow. */
export type ToolId = BuiltinToolId | `custom:${string}`;

export type FieldKind = "prompt" | "text" | "int" | "float" | "seed" | "bool" | "combo" | "image";

/** One exposed input of an imported workflow. */
export interface CustomField {
  /** `${node}.${input}` — unique within the tool. */
  key: string;
  node: string;
  input: string;
  label: string;
  kind: FieldKind;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface CustomTool {
  id: string;
  name: string;
  description: string;
  workflow: Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;
  fields: CustomField[];
  outputNode: string;
  createdAt: number;
  updatedAt: number;
}

/** A candidate input found while analysing an imported workflow. */
export interface FieldCandidate extends CustomField {
  classType: string;
  nodeTitle: string;
  /** Pre-ticked in the mapping editor. */
  suggested: boolean;
}

export interface LoraInfo {
  name: string;
  note: string;
  defaultStrength: number;
  hasPreview: boolean;
}

/** What led to the prompt: kept with every image so it can be reproduced or continued. */
export interface PromptOrigin {
  idea?: string;
  presetId?: string;
  presetName?: string;
  systemPrompt?: string;
  llmModel?: string;
  chat?: ChatMessage[];
}

export interface GenerateRequest {
  tool?: ToolId;
  params: GenerateParams;
  /** A selection drawn in the browser, as a PNG data URL at the source image's size. Saved as params.maskId. */
  mask?: string;
  count: number;
  origin?: PromptOrigin;
}

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface Job {
  id: string;
  status: JobStatus;
  tool: ToolId;
  params: GenerateParams;
  origin?: PromptOrigin;
  progress: number; // 0..1
  stage?: string;
  error?: string;
  imageId?: string;
  createdAt: number;
}

export type MediaKind = "image" | "video";

export interface ImageRecord {
  id: string;
  /** Videos keep a poster (first frame) and last frame as PNGs next to the mp4. */
  media: MediaKind;
  /** Seconds, for videos. */
  duration?: number;
  /** A ToolId, or "upload" for images brought in from outside. */
  tool: ToolId | "upload";
  params: GenerateParams;
  origin?: PromptOrigin;
  parentId?: string;
  width: number;
  height: number;
  favorite: boolean;
  createdAt: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Settings {
  comfyUrl: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  llmTemperature: number;
  /** Ask the model to skip its reasoning phase (reasoning_effort: "none"). */
  llmDisableThinking: boolean;
  /** Ask LM Studio to unload its models before each generation, so the GPU is free. */
  unloadLlmBeforeGenerate: boolean;
  /** Ask ComfyUI to free VRAM before each LLM call, when nothing is generating. */
  freeComfyBeforeLlm: boolean;
  defaultPresetId: string;
  /** Saved LoRA stacks, reusable from the composer. */
  loraCombos: { name: string; loras: LoraUse[] }[];
}

export type ServerEvent =
  | { type: "job"; job: Job }
  | { type: "image"; image: ImageRecord };
