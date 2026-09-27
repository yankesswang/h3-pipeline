// Types shared by the server (API routes) and the browser.

export type ModelFamily = "qwen-image" | "flux" | "sdxl" | "generic";

export const FAMILY_LABELS: Record<ModelFamily, string> = {
  "qwen-image": "Qwen-Image（自然語言）",
  flux: "Flux（自然語言）",
  sdxl: "SDXL / Illustrious（tag）",
  generic: "通用",
};

/** What a preset writes: prompts for new images, or instructions for editing one. */
export type PresetPurpose = "generate" | "edit";

export const PURPOSE_LABELS: Record<PresetPurpose, string> = {
  generate: "生成新圖",
  edit: "修圖指令",
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
}

export interface LoraUse {
  name: string;
  strength: number;
}

export type BuiltinToolId = "qwen21-t2i" | "qwen21-edit";
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

export interface ImageRecord {
  id: string;
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
