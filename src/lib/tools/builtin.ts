import type { Tool } from "./types";

// Built from the official Qwen Image 2.1 text-to-image template with the GGUF
// loader, flattened out of its subgraph into API format.
export const qwen21TextToImage: Tool = {
  id: "qwen21-t2i",
  name: "Qwen Image 2.1 文生圖",
  family: "qwen-image",
  outputNode: "9",
  workflow: {
    "1": { class_type: "UnetLoaderGGUF", inputs: { unet_name: "qwen-image-2.1-UC-Q4_K_M.gguf" } },
    "2": { class_type: "QwenImage21Cache", inputs: { model: ["1", 0], device: "auto", dtype: "default" } },
    "3": {
      class_type: "CLIPLoader",
      inputs: { clip_name: "qwen3vl_8b_int8_convrot.safetensors", type: "qwen_image", device: "default" },
    },
    "4": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    "5": {
      class_type: "TextEncodeQwenImage21",
      inputs: { clip: ["3", 0], prompt: "", negative_prompt: "", resolution: 1024 },
    },
    "6": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["2", 0],
        positive: ["5", 0],
        negative: ["5", 1],
        latent_image: ["6", 0],
        seed: 0,
        steps: 40,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1,
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["4", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "comfy-studio/img" } },
  },
  fields: {
    prompt: { node: "5", input: "prompt" },
    negativePrompt: { node: "5", input: "negative_prompt" },
    width: { node: "6", input: "width" },
    height: { node: "6", input: "height" },
    steps: { node: "7", input: "steps" },
    cfg: { node: "7", input: "cfg" },
    seed: { node: "7", input: "seed" },
  },
};

export const builtinTools: Record<string, Tool> = {
  [qwen21TextToImage.id]: qwen21TextToImage,
};
