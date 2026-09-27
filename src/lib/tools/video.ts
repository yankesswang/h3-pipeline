import type { ApiWorkflow, Tool } from "./types";

// MiniMax H3 text/image to video with audio, from the official
// video_minimax_h3_i2v template: int8 model, 8-step Turbo LoRA, fp16 video VAE.
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
}): ApiWorkflow {
  const wf: ApiWorkflow = {
    "30": { class_type: "UNETLoader", inputs: { unet_name: "minimax_h3_fl2va_pruned_int8_convrot.safetensors", weight_dtype: "default" } },
    "31": {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["30", 0], lora_name: "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors", strength_model: 1 },
    },
    "32": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" } },
    "33": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" } },
    "34": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" } },
    "40": {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: { clip: ["32", 0], vae: ["33", 0], prompt: o.prompt, width: o.width, height: o.height, length: framesFor(o.seconds) },
    },
    "9": { class_type: "RandomNoise", inputs: { noise_seed: o.seed } },
    "41": { class_type: "BasicGuider", inputs: { model: ["31", 0], conditioning: ["40", 0] } },
    "42": { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    "43": { class_type: "BasicScheduler", inputs: { model: ["31", 0], scheduler: "simple", steps: 8, denoise: 1 } },
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
  return wf;
}
