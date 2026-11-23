import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { ModelCatalog } from "@/lib/shared/monitor";
import { qwen21TextToImage } from "@/lib/tools/builtin";
import { buildPrompt, type ApiWorkflow } from "@/lib/tools/types";
import { buildVideoWorkflow } from "@/lib/tools/video";
import { comfy } from "./comfy";
import { afterGenerate, beforeGenerate, noteLlmLoaded } from "./gpu";
import { busy } from "./queue";
import { getSettings, saveSettings } from "./settings";

// Which model holds the GPU, and switching it from the monitor. 16 GB fits one
// of: Qwen Image 2.1, MiniMax H3, or an LM Studio model, so switching means
// clearing the others and loading the one asked for. ComfyUI loads models
// lazily, so its models are "loaded" by running a tiny throwaway generation.

const LMS = path.join(os.homedir(), ".lmstudio", "bin", "lms");

const COMFY_MODELS = [
  { id: "qwen-image", label: "Qwen Image 2.1", desc: "生圖、修圖、批次修圖" },
  { id: "minimax-video", label: "MiniMax H3", desc: "影片（含聲音）" },
];

interface State {
  switching: { target: string; stage: string } | null;
  lastError?: string;
  llms?: { at: number; list: ModelCatalog["llms"] };
}

const st = ((globalThis as unknown as { __models?: State }).__models ??= { switching: null });

function lms(args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(LMS, args, { timeout }, (err, out, errOut) =>
      err ? reject(new Error((errOut || out || err.message).toString().trim().split("\n").pop())) : resolve(out.toString()),
    ),
  );
}

/** LM Studio's chat models with their file size (about what they need in VRAM). Cached for 30 s. */
async function llmList(): Promise<ModelCatalog["llms"]> {
  if (st.llms && Date.now() - st.llms.at < 30_000) return st.llms.list;
  try {
    const all = JSON.parse(await lms(["ls", "--json"], 10_000)) as {
      type: string;
      modelKey: string;
      displayName?: string;
      sizeBytes: number;
      paramsString?: string;
      quantization?: { name?: string };
      vision?: boolean;
    }[];
    const list = all
      .filter((m) => m.type === "llm")
      .map((m) => ({
        key: m.modelKey,
        label: m.displayName ?? m.modelKey,
        sizeMb: m.sizeBytes / 1024 / 1024,
        params: m.paramsString,
        quant: m.quantization?.name,
        vision: !!m.vision,
      }))
      .sort((a, b) => a.sizeMb - b.sizeMb);
    st.llms = { at: Date.now(), list };
    return list;
  } catch {
    return []; // LM Studio's CLI is not installed
  }
}

export async function catalog(): Promise<ModelCatalog> {
  return {
    comfy: COMFY_MODELS,
    llms: await llmList(),
    comfyResident: comfy.resident,
    currentLlm: getSettings().llmModel,
    switching: st.switching,
    lastError: st.lastError,
  };
}

/** Start switching the GPU to `target` (a ComfyUI model id or an LM Studio model key); progress shows in `catalog()`. */
export async function switchTo(target: string) {
  if (st.switching) throw new Error("正在切換模型，請稍候");
  if (busy()) throw new Error("正在生成圖片或影片，等完成後再切換");
  const isComfy = COMFY_MODELS.some((m) => m.id === target);
  if (!isComfy && !(await llmList()).some((m) => m.key === target)) throw new Error(`找不到模型 ${target}`);
  st.switching = { target, stage: "準備中" };
  st.lastError = undefined;
  void (isComfy ? toComfy(target) : toLlm(target))
    .catch((e) => {
      st.lastError = e instanceof Error ? e.message : String(e);
    })
    .finally(() => {
      st.switching = null;
    });
}

const stage = (s: string) => {
  if (st.switching) st.switching.stage = s;
};

async function toLlm(key: string) {
  stage("釋放 ComfyUI");
  await comfy.free().catch(() => {});
  stage("卸載其他 LLM");
  await lms(["unload", "--all"], 30_000).catch(() => {});
  stage("載入模型");
  await lms(["load", key, "-y"], 5 * 60_000);
  noteLlmLoaded();
  // The prompt assistant follows the switch.
  saveSettings({ llmModel: key });
}

async function toComfy(id: string) {
  await beforeGenerate();
  try {
    stage("卸載 LLM");
    await lms(["unload", "--all"], 30_000).catch(() => {});
    if (comfy.resident !== id) {
      stage("釋放 ComfyUI");
      if (await comfy.hasQueuedWork()) throw new Error("ComfyUI 仍有其他任務，完成後請重試模型切換");
      await comfy.free();
      await new Promise((r) => setTimeout(r, 1500));
    }
    stage("載入模型");
    const promptId = await comfy.submit(id === "qwen-image" ? imageWarmup() : videoWarmup());
    for (let waited = 0; ; waited += 1000) {
      if (waited > 10 * 60_000) throw new Error("載入超過 10 分鐘，放棄");
      await new Promise((r) => setTimeout(r, 1000));
      const h = await comfy.history(promptId).catch(() => undefined);
      if (h?.status?.status_str === "error") throw new Error("ComfyUI 載入模型失敗，請看 ComfyUI 的訊息");
      if (h?.status?.completed) break;
    }
    comfy.resident = id;
  } finally {
    afterGenerate();
  }
}

/** One step at 256 px with a preview output: loads every model, saves nothing. */
function imageWarmup(): ApiWorkflow {
  const wf = buildPrompt(qwen21TextToImage, { prompt: "a plain gray square", steps: 1, width: 256, height: 256, seed: 0 });
  wf["9"] = { class_type: "PreviewImage", inputs: { images: ["8", 0] } };
  return wf;
}

/** Five frames at 256 px, one step, audio and saving left out. */
function videoWarmup(): ApiWorkflow {
  const wf = buildVideoWorkflow({ prompt: "a plain gray square", seed: 0, seconds: 0.1, megapixels: 0.1, width: 256, height: 256 });
  wf["43"].inputs.steps = 1;
  for (const id of ["51", "52", "53", "58", "59", "60", "61"]) delete wf[id];
  wf["70"] = { class_type: "PreviewImage", inputs: { images: ["50", 0] } };
  return wf;
}
