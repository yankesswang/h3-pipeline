import type { ApiWorkflow, Tool } from "./types";

// MiniMax H3 Image, from the official image_minimax_h3_image_t2i template without
// its prompt expander: int8 DiT, the nvfp4 Qwen3-VL 32B encoder shared with H3
// video, fp16 VAE. The checkpoint is distilled, so it always runs 6 steps at CFG 1
// with no negative prompt. Editing is the same graph with the pictures attached.

const graph = (width: number, height: number): ApiWorkflow => ({
  "1": { class_type: "UNETLoader", inputs: { unet_name: "minimax_h3_image_pruned_int8_convrot.safetensors", weight_dtype: "default" } },
  "2": {
    class_type: "CLIPLoader",
    inputs: { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" },
  },
  "3": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_image_vae_fp16.safetensors" } },
  "5": { class_type: "MiniMaxH3ImageConditioning", inputs: { clip: ["2", 0], vae: ["3", 0], prompt: "", width, height } },
  "6": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["5", 0] } },
  "7": {
    class_type: "KSampler",
    inputs: {
      model: ["1", 0],
      positive: ["5", 0],
      negative: ["6", 0],
      latent_image: ["5", 1],
      seed: 0,
      steps: 6,
      cfg: 1,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: 1,
    },
  },
  "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
  "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "comfy-studio/img" } },
});

export const H3_STEPS = 6;

export const h3ImageTextToImage: Tool = {
  id: "h3-image-t2i",
  name: "MiniMax H3 Image 文生圖",
  family: "minimax-h3-image",
  outputNode: "9",
  workflow: graph(2048, 2048),
  fields: {
    prompt: { node: "5", input: "prompt" },
    seed: { node: "7", input: "seed" },
    width: { node: "5", input: "width" },
    height: { node: "5", input: "height" },
  },
};

// Size 0 x 0: the canvas follows image_1, its short edge kept within 1024-2048.
export const h3ImageEdit: Tool = {
  id: "h3-image-edit",
  name: "MiniMax H3 Image 修圖",
  family: "minimax-h3-image",
  outputNode: "9",
  workflow: graph(0, 0),
  fields: {
    prompt: { node: "5", input: "prompt" },
    seed: { node: "7", input: "seed" },
  },
  imageInput: { node: "5", prefix: "images.image_", max: 16 },
};

/**
 * The composer writes <image1>, <image2>... (Qwen's tokens); H3 calls them <Picture 1>, <Picture 2>...
 * An instruction that names no picture is about the first one, as the official edit prompt puts it.
 */
export function h3EditPrompt(prompt: string) {
  const out = prompt.replace(/<image(\d+)>/gi, "<Picture $1>");
  return /<Picture \d+>/.test(out) ? out : `Edit <Picture 1>. ${out}`;
}
