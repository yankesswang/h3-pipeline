import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { comfy } from "./comfy";
import { getSettings } from "./settings";

// The image model and a local LLM do not fit in 16 GB together, so they take
// turns: generation unloads LM Studio's models, and (optionally) LLM calls ask
// ComfyUI to free VRAM when nothing is generating.

const state = ((globalThis as unknown as { __gpu?: { llmLoaded: boolean; generating: boolean } }).__gpu ??= {
  llmLoaded: false,
  generating: false,
});

const LMS = path.join(os.homedir(), ".lmstudio", "bin", "lms");

function isLocalLmStudio(baseUrl: string) {
  try {
    const u = new URL(baseUrl);
    return ["127.0.0.1", "localhost"].includes(u.hostname) && u.port === "1234";
  } catch {
    return false;
  }
}

export async function beforeLlmCall() {
  const s = getSettings();
  if (!isLocalLmStudio(s.llmBaseUrl)) return;
  state.llmLoaded = true;
  if (s.freeComfyBeforeLlm && !state.generating) await comfy.free().catch(() => {});
}

/**
 * LM Studio could not load its model, most likely because ComfyUI holds the
 * VRAM. Free ComfyUI's models if nothing is generating; returns whether it did.
 */
export async function freeComfyForLlm(): Promise<boolean> {
  if (state.generating || !isLocalLmStudio(getSettings().llmBaseUrl)) return false;
  try {
    await comfy.free();
    // ComfyUI frees asynchronously, between prompts; give it a moment.
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  } catch {
    return false;
  }
}

export async function beforeGenerate() {
  state.generating = true;
  const s = getSettings();
  if (!s.unloadLlmBeforeGenerate || !state.llmLoaded || !isLocalLmStudio(s.llmBaseUrl)) return;
  await new Promise<void>((resolve) => {
    execFile(LMS, ["unload", "--all"], { timeout: 10_000 }, () => resolve());
  });
  state.llmLoaded = false;
}

export function afterGenerate() {
  state.generating = false;
}
