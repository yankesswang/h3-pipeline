import type { VideoSpeed } from "@/lib/shared/types";
import type { ApiWorkflow, Tool } from "./types";

// MiniMax H3 text/image to video with audio, from the official
// video_minimax_h3_i2v template: int8 model, a 4 or 8-step Turbo LoRA, fp16 video VAE.
// Unlike the ComfyUI workflow (which switches modes with booleans), the mode is
// decided here, so only the nodes a run needs are sent.
//
// Two extra SaveImage nodes keep the first frame (the poster) and the last
// frame (to continue from), so no video decoding is needed anywhere else.

export const VIDEO_OUTPUT = { video: "53", first: "60", last: "61" };

export const minimaxH3Video: Tool = {
  id: "minimax-h3-video",
  name: "MiniMax H3 影片",
  family: "minimax-h3",
  outputNode: VIDEO_OUTPUT.video,
  workflow: {}, // built per run by buildVideoWorkflow
  fields: {},
  loraSlot: { from: ["31", 0], into: { node: "41", input: "model" } },
};

/**
 * Each speed's LoRA (none = base model), its default steps and the step range worth offering.
 * The pi-H3 entries load a LakonLab DWD adapter instead (ComfyUI-piFlow): a fixed 2 or 4
 * steps on the pi-Flow schedule, and the frames come from the adapter's head, not the VAE.
 */
export const VIDEO_SPEEDS: Record<
  VideoSpeed,
  { label: string; lora?: string; adapter?: { file: string; maxRawT: number }; steps: number; min: number; max: number; hint: string }
> = {
  pi2: {
    label: "pi-H3 2 步",
    adapter: { file: "pi_h3_2step_dwd_adapter_int8_convrot.safetensors", maxRawT: 0.93 },
    steps: 2,
    min: 2,
    max: 2,
    hint: "pi-H3 蒸餾，最快；不經 VAE 解碼",
  },
  pi4: {
    label: "pi-H3 4 步",
    adapter: { file: "pi_h3_4step_dwd_adapter_int8_convrot.safetensors", maxRawT: 0.96 },
    steps: 4,
    min: 4,
    max: 4,
    hint: "pi-H3 蒸餾，品質較 2 步好；不經 VAE 解碼",
  },
  turbo4: {
    label: "4 步",
    lora: "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
    steps: 4,
    min: 2,
    max: 8,
    hint: "最快；為 768p 訓練，低解析度時細節可能較少",
  },
  turbo8: {
    label: "8 步",
    lora: "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
    steps: 8,
    min: 4,
    max: 16,
    hint: "速度與品質平衡，官方 6–8 步",
  },
  base: { label: "原始模型", steps: 20, min: 8, max: 40, hint: "約 20 步，最慢、細節最多" },
};

export const DEFAULT_VIDEO_SPEED: VideoSpeed = "pi4";

/** Bumped when the default speed changes, so a browser's saved speed (likely just the old default) is reset once. */
export const VIDEO_SPEED_REV = 2;

/** A clip's speed; older clips only recorded whether Turbo (then always 8-step) was on. */
export const speedOf = (v?: { speed?: VideoSpeed; turbo?: boolean }): VideoSpeed =>
  v?.speed ?? (v?.turbo === false ? "base" : "turbo8");

/** Rough run time in seconds on this machine: 3 s at 0.4 MP with 8 Turbo steps takes about 50 s. */
export function videoEstimate(seconds: number, megapixels: number, steps: number) {
  const est = (framesFor(seconds) / 73) * (megapixels / 0.4) * (steps / 8) * 50;
  return Math.max(10, Math.round(est / 10) * 10);
}

/** A keyframe's time as a frame index, kept clear of the first and last frames. */
export function keyframeIndex(at: number, frames: number) {
  return Math.min(frames - 2, Math.max(1, Math.round(at * 24)));
}

/** Seconds → frame count on H3's 24 fps, 17k+5 grid (3 s → 73, 5 s → 124). */
export function framesFor(seconds: number) {
  const n = Math.max(5, Math.round(seconds * 24));
  return n + ((((5 - (n % 17)) % 17) + 17) % 17);
}

/** Text-mode size for a pixel budget and aspect ratio, in multiples of 32. */
export function videoSize(megapixels: number, aspectW: number, aspectH: number) {
  const px = megapixels * 1024 * 1024;
  const round32 = (n: number) => Math.max(256, Math.round(n / 32) * 32);
  const width = round32(Math.sqrt((px * aspectW) / aspectH));
  return { width, height: round32((width * aspectH) / aspectW) };
}

export function buildVideoWorkflow(o: {
  prompt: string;
  seed: number;
  seconds: number;
  megapixels: number;
  /** Text mode size; ignored when there is a first frame. */
  width: number;
  height: number;
  /** Uploaded file names in ComfyUI's input folder. */
  firstFrame?: string;
  lastFrame?: string;
  /** Uploaded images anchored in between, at these seconds. */
  keyframes?: { file: string; at: number }[];
  /** Defaults: DEFAULT_VIDEO_SPEED, its step count, res_multistep, simple. */
  speed?: VideoSpeed;
  steps?: number;
  sampler?: string;
  scheduler?: string;
}): ApiWorkflow {
  const speed = VIDEO_SPEEDS[o.speed ?? DEFAULT_VIDEO_SPEED];
  // Without a Turbo LoRA or adapter the sampler takes the base model straight from the loader.
  const model: [string, number] = speed.lora || speed.adapter ? ["31", 0] : ["30", 0];
  const wf: ApiWorkflow = {
    "30": { class_type: "UNETLoader", inputs: { unet_name: "minimax_h3_fl2va_pruned_int8_convrot.safetensors", weight_dtype: "default" } },
    "31": {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["30", 0], lora_name: speed.lora ?? "", strength_model: 1 },
    },
    "32": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" } },
    "33": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" } },
    "34": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" } },
    "40": {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: { clip: ["32", 0], vae: ["33", 0], prompt: o.prompt, width: o.width, height: o.height, length: framesFor(o.seconds) },
    },
    "9": { class_type: "RandomNoise", inputs: { noise_seed: o.seed } },
    "41": { class_type: "BasicGuider", inputs: { model, conditioning: ["40", 0] } },
    "42": { class_type: "KSamplerSelect", inputs: { sampler_name: o.sampler || "res_multistep" } },
    "43": {
      class_type: "BasicScheduler",
      inputs: { model, scheduler: o.scheduler || "simple", steps: o.steps || speed.steps, denoise: 1 },
    },
    "44": {
      class_type: "SamplerCustomAdvanced",
      inputs: { noise: ["9", 0], guider: ["41", 0], sampler: ["42", 0], sigmas: ["43", 0], latent_image: ["40", 1] },
    },
    "50": { class_type: "VAEDecode", inputs: { samples: ["44", 0], vae: ["33", 0] } },
    "51": { class_type: "VAEDecodeAudio", inputs: { samples: ["44", 0], vae: ["34", 0] } },
    "52": { class_type: "CreateVideo", inputs: { images: ["50", 0], audio: ["51", 0], fps: 24 } },
    "53": { class_type: "SaveVideo", inputs: { video: ["52", 0], filename_prefix: "comfy-studio/video", format: "auto", codec: "auto" } },
    "58": { class_type: "ImageFromBatch", inputs: { image: ["50", 0], batch_index: 0, length: 1 } },
    "59": { class_type: "ImageFromBatch", inputs: { image: ["50", 0], batch_index: -1, length: 1 } },
    "60": { class_type: "SaveImage", inputs: { images: ["58", 0], filename_prefix: "comfy-studio/video-first" } },
    "61": { class_type: "SaveImage", inputs: { images: ["59", 0], filename_prefix: "comfy-studio/video-last" } },
  };
  if (speed.adapter) {
    // pi-H3 (ComfyUI-piFlow's pi-H3-DWD workflow, dense attention): shift, then the adapter
    // in node 31 so user LoRAs still chain from it; euler on the pi-Flow schedule; the
    // DWD head's pixels replace the VAE decode.
    wf["35"] = { class_type: "MiniMaxH3SigmaShift", inputs: { model: ["30", 0], shift_video: 12, shift_audio: 3 } };
    wf["31"] = {
      class_type: "Load LakonLab Adapter",
      inputs: { model: ["35", 0], adapter_name: speed.adapter.file, adapter_strength: 1 },
    };
    wf["42"].inputs.sampler_name = "euler";
    wf["43"] = {
      class_type: "pi-Flow Scheduler",
      inputs: { model, steps: speed.steps, min_raw_t: 0, max_raw_t: speed.adapter.maxRawT, final_step_size_scale: 0.6 },
    };
    wf["50"] = { class_type: "DWD Decode", inputs: { samples: ["44", 0] } };
  } else if (!speed.lora) delete wf["31"];
  if (o.firstFrame) {
    // Image mode: the first frame sets the size, scaled to the pixel budget.
    wf["20"] = { class_type: "LoadImage", inputs: { image: o.firstFrame } };
    wf["21"] = {
      class_type: "ImageScaleToTotalPixels",
      inputs: { image: ["20", 0], upscale_method: "lanczos", megapixels: o.megapixels, resolution_steps: 32 },
    };
    wf["22"] = { class_type: "GetImageSize", inputs: { image: ["21", 0] } };
    Object.assign(wf["40"].inputs, { first_frame: ["21", 0], width: ["22", 0], height: ["22", 1] });
  }
  if (o.lastFrame) {
    wf["23"] = { class_type: "LoadImage", inputs: { image: o.lastFrame } };
    wf["40"].inputs.last_frame = ["23", 0];
  }
  // Keyframes in between: a chain of AddGuide nodes, each anchoring one image at
  // its frame, feeding the guider instead of the plain conditioning.
  const frames = framesFor(o.seconds);
  let positive: [string, number] = ["40", 0];
  (o.keyframes ?? []).forEach((k, i) => {
    const load = String(70 + i * 2);
    const guide = String(71 + i * 2);
    wf[load] = { class_type: "LoadImage", inputs: { image: k.file } };
    wf[guide] = {
      class_type: "MiniMaxH3AddGuide",
      inputs: { positive, latent: ["40", 1], vae: ["33", 0], image: [load, 0], frame_idx: keyframeIndex(k.at, frames) },
    };
    positive = [guide, 0];
  });
  wf["41"].inputs.conditioning = positive;
  return wf;
}
