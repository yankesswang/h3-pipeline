import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import type { GenerateParams, Job, PromptOrigin, ServerEvent } from "@/lib/shared/types";
import { builtinTools } from "@/lib/tools/builtin";
import { buildPrompt, type Tool } from "@/lib/tools/types";
import { comfy, type ComfyMessage } from "./comfy";
import { afterGenerate, beforeGenerate } from "./gpu";
import { insertImage } from "./repo";

// One GPU, so jobs run strictly one at a time, in order.

const STAGES: Record<string, string> = {
  UnetLoaderGGUF: "載入模型",
  CLIPLoader: "載入文字編碼器",
  VAELoader: "載入 VAE",
  QwenImage21Cache: "載入模型",
  EmptyLatentImage: "準備畫布",
  TextEncodeQwenImage21: "理解 prompt",
  KSampler: "生成中",
  VAEDecode: "解碼",
  SaveImage: "儲存",
};

interface QueueState {
  jobs: Job[];
  running: boolean;
  comfyPromptIds: Map<string, string>;
  bus: EventEmitter;
}

const q: QueueState = ((globalThis as unknown as { __queue?: QueueState }).__queue ??= {
  jobs: [],
  running: false,
  comfyPromptIds: new Map(),
  bus: new EventEmitter().setMaxListeners(100),
});

export const bus = q.bus;

function emit(ev: ServerEvent) {
  bus.emit("event", ev);
}

function update(job: Job, patch: Partial<Job>) {
  Object.assign(job, patch);
  emit({ type: "job", job });
}

export function listJobs() {
  return q.jobs;
}

export function enqueue(toolId: string, params: GenerateParams, origin?: PromptOrigin): Job {
  if (!builtinTools[toolId]) throw new Error(`Unknown tool ${toolId}`);
  const job: Job = {
    id: nanoid(10),
    status: "queued",
    tool: toolId,
    params,
    origin,
    progress: 0,
    createdAt: Date.now(),
  };
  q.jobs.push(job);
  // Keep finished jobs around briefly so the UI can show what just happened.
  const finished = q.jobs.filter((j) => j.status !== "queued" && j.status !== "running");
  if (finished.length > 30) q.jobs = q.jobs.filter((j) => !finished.slice(0, finished.length - 30).includes(j));
  emit({ type: "job", job });
  void pump();
  return job;
}

export async function cancel(jobId: string) {
  const job = q.jobs.find((j) => j.id === jobId);
  if (!job) return false;
  if (job.status === "queued") update(job, { status: "cancelled" });
  else if (job.status === "running") {
    const pid = q.comfyPromptIds.get(job.id);
    if (pid) await comfy.interrupt(pid).catch(() => {});
  }
  return true;
}

async function pump() {
  if (q.running) return;
  q.running = true;
  try {
    for (;;) {
      const job = q.jobs.find((j) => j.status === "queued");
      if (!job) break;
      await run(job);
    }
  } finally {
    q.running = false;
  }
}

async function run(job: Job) {
  const tool = builtinTools[job.tool];
  update(job, { status: "running", stage: "準備 GPU", progress: 0 });
  try {
    await beforeGenerate();
    const promptId = await comfy.submit(buildPrompt(tool, { ...job.params }));
    q.comfyPromptIds.set(job.id, promptId);
    update(job, { stage: "排入 ComfyUI" });
    const outcome = await waitFor(job, promptId);
    if (outcome === "interrupted") return update(job, { status: "cancelled", stage: undefined });
    const image = await collect(job, tool, promptId);
    update(job, { status: "done", progress: 1, stage: undefined, imageId: image.id });
  } catch (e) {
    update(job, { status: "error", stage: undefined, error: e instanceof Error ? e.message : String(e) });
  } finally {
    q.comfyPromptIds.delete(job.id);
    afterGenerate();
  }
}

/** Resolve when ComfyUI finishes the prompt. Websocket for progress, history polling as a backstop. */
function waitFor(job: Job, promptId: string): Promise<"success" | "interrupted"> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      comfy.events.off(promptId, onMsg);
      clearInterval(poll);
      fn();
    };
    const onMsg = (msg: ComfyMessage) => {
      switch (msg.type) {
        case "progress":
          update(job, { progress: msg.data.value / msg.data.max });
          break;
        case "executing": {
          if (msg.data.node === null) return finish(() => resolve("success"));
          const node = builtinTools[job.tool].workflow[msg.data.node];
          if (node) update(job, { stage: STAGES[node.class_type] ?? node.class_type });
          break;
        }
        case "execution_success":
          return finish(() => resolve("success"));
        case "execution_interrupted":
          return finish(() => resolve("interrupted"));
        case "execution_error":
          return finish(() => reject(new Error(`${msg.data.node_type}: ${msg.data.exception_message}`)));
      }
    };
    comfy.events.on(promptId, onMsg);
    const poll = setInterval(async () => {
      const h = await comfy.history(promptId).catch(() => undefined);
      if (!h?.status?.completed && h?.status?.status_str !== "error") return;
      if (h.status.status_str === "error") {
        const interrupted = h.status.messages?.some(([t]) => t === "execution_interrupted");
        finish(() => (interrupted ? resolve("interrupted") : reject(new Error("ComfyUI 執行失敗"))));
      } else finish(() => resolve("success"));
    }, 3000);
  });
}

async function collect(job: Job, tool: Tool, promptId: string) {
  const h = await comfy.history(promptId);
  const ref = h?.outputs?.[tool.outputNode]?.images?.[0];
  if (!ref) throw new Error("ComfyUI 沒有回傳圖片");
  const png = await comfy.fetchImage(ref);
  const image = insertImage(
    {
      id: nanoid(12),
      tool: tool.id,
      params: job.params,
      origin: job.origin,
      width: job.params.width,
      height: job.params.height,
      favorite: false,
      createdAt: Date.now(),
    },
    png,
  );
  emit({ type: "image", image });
  return image;
}
