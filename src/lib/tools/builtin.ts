import type { BuiltinToolId } from "@/lib/shared/types";
import type { ApiWorkflow, Tool } from "./types";
import { h3ImageEdit, h3ImageTextToImage } from "./h3-image";
import { minimaxH3Video } from "./video";

// The Qwen tools are built from the official Qwen Image 2.1 templates with the
// GGUF loader, flattened out of their subgraphs into API format.

const loaders: ApiWorkflow = {
  "1": { class_type: "UnetLoaderGGUF", inputs: { unet_name: "qwen-image-2.1-UC-Q4_K_M.gguf" } },
  "2": { class_type: "QwenImage21Cache", inputs: { model: ["1", 0], device: "auto", dtype: "default" } },
  "3": {
    class_type: "CLIPLoader",
    inputs: { clip_name: "qwen3vl_8b_int8_convrot.safetensors", type: "qwen_image", device: "default" },
  },
  "4": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
};

const sampler = (latent: [string, number]) => ({
  class_type: "KSampler",
  inputs: {
    model: ["2", 0],
    positive: ["5", 0],
    negative: ["5", 1],
    latent_image: latent,
    seed: 0,
    steps: 40,
    cfg: 1,
    sampler_name: "euler",
    scheduler: "simple",
    denoise: 1,
  },
});

const tail: ApiWorkflow = {
  "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["4", 0] } },
  "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "comfy-studio/img" } },
};

const commonFields = {
  prompt: { node: "5", input: "prompt" },
  negativePrompt: { node: "5", input: "negative_prompt" },
  steps: { node: "7", input: "steps" },
  cfg: { node: "7", input: "cfg" },
  seed: { node: "7", input: "seed" },
  sampler: { node: "7", input: "sampler_name" },
  scheduler: { node: "7", input: "scheduler" },
};

export const qwen21TextToImage: Tool = {
  id: "qwen21-t2i",
  name: "Qwen Image 2.1 文生圖",
  family: "qwen-image",
  outputNode: "9",
  workflow: {
    ...loaders,
    "5": {
      class_type: "TextEncodeQwenImage21",
      inputs: { clip: ["3", 0], prompt: "", negative_prompt: "", resolution: 1024 },
    },
    "6": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "7": sampler(["6", 0]),
    ...tail,
  },
  loraSlot: { from: ["1", 0], into: { node: "2", input: "model" } },
  fields: {
    ...commonFields,
    width: { node: "6", input: "width" },
    height: { node: "6", input: "height" },
  },
};

// The encoder sees every reference image; its third output is image_1's
// latent, which the sampler starts from, so the result keeps image_1's size.
export const qwen21Edit: Tool = {
  id: "qwen21-edit",
  name: "Qwen Image 2.1 修圖",
  family: "qwen-image",
  outputNode: "9",
  workflow: {
    ...loaders,
    "5": {
      class_type: "TextEncodeQwenImage21",
      inputs: { clip: ["3", 0], vae: ["4", 0], prompt: "", negative_prompt: "", resolution: 0 },
    },
    "7": sampler(["5", 2]),
    ...tail,
  },
  loraSlot: { from: ["1", 0], into: { node: "2", input: "model" } },
  fields: {
    ...commonFields,
    // Pixel budget each image is resized to; 0 keeps every image at its own size.
    resolution: { node: "5", input: "resolution" },
    // Starts from image_1's latent, so below 1 keeps more of the source.
    denoise: { node: "7", input: "denoise" },
  },
  imageInput: { node: "5", prefix: "images.image_", max: 10 },
};

export const builtinTools: Record<BuiltinToolId, Tool> = {
  "qwen21-t2i": qwen21TextToImage,
  "qwen21-edit": qwen21Edit,
  "h3-image-t2i": h3ImageTextToImage,
  "h3-image-edit": h3ImageEdit,
  "minimax-h3-video": minimaxH3Video,
};
