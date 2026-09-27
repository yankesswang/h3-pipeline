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
}

export type ToolId = "qwen21-t2i" | "qwen21-edit";

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
}

export type ServerEvent =
  | { type: "job"; job: Job }
  | { type: "image"; image: ImageRecord };
