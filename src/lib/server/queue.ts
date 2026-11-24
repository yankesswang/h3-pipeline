import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { isEditTool, type GenerateParams, type Job, type PromptOrigin, type ServerEvent, type ToolId } from "@/lib/shared/types";
import { buildPrompt, type ApiWorkflow, type Tool } from "@/lib/tools/types";
import { h3EditPrompt } from "@/lib/tools/h3-image";
import { buildVideoWorkflow, framesFor, VIDEO_OUTPUT, speedOf } from "@/lib/tools/video";
import { comfy, type ComfyMessage } from "./comfy";
import { afterGenerate, beforeGenerate } from "./gpu";
import { pngSize } from "./images";
import { maskPath } from "./masks";
import { DEFAULT_OUTPAINT_PROMPT, prepareMasked, prepareOutpaint, stitchMasked, stitchOutpaint, type Rect } from "./regions";
import { getImage, imagePath, insertImage } from "./repo";
import { customFields, resolveTool } from "./tools";

// One GPU, so jobs run strictly one at a time, in order.

const STAGES: Record<string, string> = {
  UnetLoaderGGUF: "載入模型",
  LoraLoaderModelOnly: "載入 LoRA",
  LoraLoader: "載入 LoRA",
  CheckpointLoaderSimple: "載入模型",
  CLIPTextEncode: "理解 prompt",
  KSamplerAdvanced: "生成中",
  SamplerCustomAdvanced: "生成中",
  PreviewImage: "儲存",
  CLIPLoader: "載入文字編碼器",
  VAELoader: "載入 VAE",
  QwenImage21Cache: "載入模型",
  EmptyLatentImage: "準備畫布",
  TextEncodeQwenImage21: "理解 prompt",
  LoadImage: "讀取圖片",
  KSampler: "生成中",
  VAEDecode: "解碼",
  SaveImage: "儲存",
  UNETLoader: "載入模型",
  MiniMaxH3ImageConditioning: "理解 prompt",
  ConditioningZeroOut: "理解 prompt",
  ImageScaleToTotalPixels: "準備首幀",
  MiniMaxH3ImageToVideo: "理解 prompt",
  VAEDecodeAudio: "產生聲音",
  CreateVideo: "合成影片",
  SaveVideo: "儲存影片",
  ImageFromBatch: "擷取影格",
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

/** Post-processing for a running job (region stitching); kept off the Job so it never goes to the browser. */
const finishers = new WeakMap<Job, ((out: Buffer) => Promise<Buffer>) | undefined>();

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

/** Whether anything is generating or waiting to. */
export function busy() {
  return q.running || q.jobs.some((j) => j.status === "queued" || j.status === "running");
}

export function enqueue(toolId: ToolId, params: GenerateParams, origin?: PromptOrigin): Job {
  resolveTool(toolId); // throws for unknown or deleted tools
  if (toolId === "minimax-h3-video") {
    const v = params.video;
    if (!v) throw new Error("缺少影片設定");
    for (const id of [v.firstFrameId, v.lastFrameId]) if (id && !getImage(id)) throw new Error(`找不到圖片 ${id}`);
    if (v.lastFrameId && !v.firstFrameId) throw new Error("要有第一幀才能指定最後一幀");
  }
  for (const f of customFields(toolId))
    if (f.kind === "image") {
      const id = params.toolValues?.[f.key];
      if (typeof id !== "string" || !getImage(id)) throw new Error(`「${f.label}」需要選一張圖`);
    }
  if (isEditTool(toolId)) {
    const ids = [params.sourceImageId, ...(params.refImageIds ?? [])];
    if (!params.sourceImageId) throw new Error("修圖需要一張原圖");
    const missing = ids.find((id) => !id || !getImage(id));
    if (missing !== undefined) throw new Error(`找不到圖片 ${missing}`);
    const max = resolveTool(toolId).imageInput!.max;
    if (ids.length > max) throw new Error(`最多 ${max} 張圖（原圖 + ${max - 1} 張參考）`);
  }
  if (params.loras?.length && !resolveTool(toolId).loraSlot) throw new Error(`${resolveTool(toolId).name} 不支援 LoRA`);
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
  prune();
  emit({ type: "job", job });
  void pump();
  return job;
}

/**
 * Keep finished jobs around briefly so the UI can show what just happened:
 * the last 30 single jobs, and every job of the last 5 batches.
 */
function prune() {
  const finished = (j: Job) => j.status !== "queued" && j.status !== "running";
  const singles = q.jobs.filter((j) => !j.params.batch && finished(j));
  const batches = [...new Set(q.jobs.filter((j) => j.params.batch).map((j) => j.params.batch!.id))];
  const oldBatches = new Set(batches.slice(0, -5));
  const drop = new Set([
    ...singles.slice(0, Math.max(0, singles.length - 30)),
    ...q.jobs.filter((j) => j.params.batch && oldBatches.has(j.params.batch.id) && finished(j)),
  ]);
  if (drop.size) q.jobs = q.jobs.filter((j) => !drop.has(j));
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
  update(job, { status: "running", stage: "準備 GPU", progress: 0 });
  let tool: Tool | undefined;
  try {
    tool = resolveTool(job.tool);
    await beforeGenerate();
    let prompt;
    if (job.tool === "minimax-h3-video") {
      prompt = await videoWorkflow(job.params);
    } else if (job.tool.startsWith("custom:")) {
      prompt = buildPrompt(tool, await customValues(job), [], job.params.loras);
    } else {
      const region = await prepareRegion(job.params);
      const images = await uploadInputs(job.params, region?.image);
      const text = region?.prompt ?? job.params.prompt;
      const values = {
        ...job.params,
        prompt: job.tool === "h3-image-edit" ? h3EditPrompt(text) : text,
        resolution: editResolution(job.params),
        // The grown canvas has nothing worth keeping, so outpainting always re-draws fully.
        denoise: job.params.outpaint ? undefined : job.params.denoise,
      };
      prompt = buildPrompt(tool, values, images, job.params.loras);
      finishers.set(job, region?.finish);
    }
    const target =
      job.tool === "minimax-h3-video"
        ? "minimax-video"
        : job.tool.startsWith("custom:")
          ? `custom:${tool.name}`
          : tool.family === "minimax-h3-image"
            ? "minimax-image"
            : "qwen-image";
    if (comfy.resident && comfy.resident !== target) {
      update(job, { stage: "等待 ComfyUI 完成其他任務" });
      if (await comfy.hasQueuedWork()) throw new Error("ComfyUI 仍有其他任務，完成後請重試模型切換");
      update(job, { stage: "釋放上一個模型" });
      await comfy.free();
    }
    update(job, { stage: "載入模型" });
    const promptId = await comfy.submit(prompt);
    q.comfyPromptIds.set(job.id, promptId);
    update(job, { stage: "排入 ComfyUI" });
    const outcome = await waitFor(job, promptId, prompt);
    if (outcome === "interrupted") return update(job, { status: "cancelled", stage: undefined });
    comfy.resident = target;
    const image = await collect(job, tool, promptId, finishers.get(job));
    update(job, { status: "done", progress: 1, stage: undefined, imageId: image.id });
  } catch (e) {
    update(job, { status: "error", stage: undefined, error: e instanceof Error ? e.message : String(e) });
  } finally {
    q.comfyPromptIds.delete(job.id);
    finishers.delete(job);
    afterGenerate();
  }
}

async function videoWorkflow(p: GenerateParams) {
  const v = p.video;
  if (!v) throw new Error("缺少影片設定");
  const upload = (id?: string) => {
    if (!id) return undefined;
    const file = imagePath(id);
    if (!file) throw new Error(`找不到圖片 ${id}`);
    return comfy.upload(fs.readFileSync(file), `${id}.png`);
  };
  // Keyframes only make sense after a first frame, like the end frame.
  const keys = v.firstFrameId ? (v.keyframes ?? []) : [];
  const [firstFrame, lastFrame, ...keyFiles] = await Promise.all([
    upload(v.firstFrameId),
    upload(v.lastFrameId),
    ...keys.map((k) => upload(k.imageId)),
  ]);
  return buildVideoWorkflow({
    prompt: p.prompt,
    seed: p.seed,
    seconds: v.seconds,
    megapixels: v.megapixels,
    width: p.width,
    height: p.height,
    firstFrame,
    lastFrame,
    keyframes: keys.map((k, i) => ({ file: keyFiles[i]!, at: k.at })),
    speed: speedOf(v),
    steps: p.steps,
    sampler: p.sampler,
    scheduler: p.scheduler,
  });
}

/** An imported tool's values, with image fields turned into uploaded file names. */
async function customValues(job: Job) {
  const values = { ...job.params.toolValues };
  for (const f of customFields(job.tool))
    if (f.kind === "image") {
      const id = values[f.key] as string;
      const file = imagePath(id);
      if (!file) throw new Error(`找不到圖片 ${id}`);
      values[f.key] = await comfy.upload(fs.readFileSync(file), `${id}.png`);
    }
  return values;
}

/**
 * Local edits and outpainting swap the source for a prepared image (a crop, or
 * a bigger canvas) and stitch the model's output back into the original afterwards.
 */
async function prepareRegion(p: GenerateParams) {
  if (!p.sourceImageId || (!p.maskId && !p.outpaint)) return undefined;
  const source = fs.readFileSync(imagePath(p.sourceImageId)!);
  if (p.outpaint) {
    const pads = p.outpaint;
    const { canvas, width, height } = await prepareOutpaint(source, pads);
    const extra = p.prompt.trim();
    return {
      image: canvas,
      prompt: extra ? `${DEFAULT_OUTPAINT_PROMPT} ${extra}` : DEFAULT_OUTPAINT_PROMPT,
      finish: (out: Buffer) => stitchOutpaint(source, out, pads, width, height),
    };
  }
  const { crop, rect, mask } = await prepareMasked(source, fs.readFileSync(maskPath(p.maskId!)));
  return {
    image: crop,
    prompt: undefined,
    finish: (out: Buffer) => stitchMasked(source, out, rect as Rect, mask),
  };
}

/** Send the source (or its prepared stand-in) and reference images to ComfyUI's input folder. */
async function uploadInputs(p: GenerateParams, preparedSource?: Buffer): Promise<string[]> {
  if (!p.sourceImageId) return [];
  const read = (id: string) => {
    const file = imagePath(id);
    if (!file) throw new Error(`找不到圖片 ${id}`);
    return fs.readFileSync(file);
  };
  return Promise.all([
    comfy.upload(preparedSource ?? read(p.sourceImageId), preparedSource ? `${p.sourceImageId}-region.png` : `${p.sourceImageId}.png`),
    ...(p.refImageIds ?? []).map((id) => comfy.upload(read(id), `${id}.png`)),
  ]);
}

/** 0 keeps every image at its own size (uploads are already capped at 4 MP). Region edits pick their own size. */
function editResolution(p: GenerateParams) {
  if (!p.sourceImageId) return undefined;
  return p.maskId || p.outpaint ? 0 : (p.resolution ?? 0);
}

/** Resolve when ComfyUI finishes the prompt. Websocket for progress, history polling as a backstop. */
function waitFor(job: Job, promptId: string, workflow: ApiWorkflow): Promise<"success" | "interrupted"> {
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
          const node = workflow[msg.data.node];
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
    let missing = 0;
    const poll = setInterval(async () => {
      const h = await comfy.history(promptId).catch(() => undefined);
      if (!h) {
        // Not finished; make sure ComfyUI still has it. A restart drops its queue.
        const known = await comfy.inQueue(promptId).catch(() => true);
        missing = known ? 0 : missing + 1;
        if (missing >= 2) finish(() => reject(new Error("ComfyUI 重新啟動了，這個任務遺失，請再送一次")));
        return;
      }
      if (!h.status?.completed && h.status?.status_str !== "error") return;
      if (h.status.status_str === "error") {
        const interrupted = h.status.messages?.some(([t]) => t === "execution_interrupted");
        finish(() => (interrupted ? resolve("interrupted") : reject(new Error("ComfyUI 執行失敗"))));
      } else finish(() => resolve("success"));
    }, 3000);
  });
}

async function collect(job: Job, tool: Tool, promptId: string, finish?: (out: Buffer) => Promise<Buffer>) {
  const h = await comfy.history(promptId);
  if (job.tool === "minimax-h3-video") {
    const get = async (node: string) => {
      const ref = h?.outputs?.[node]?.images?.[0];
      if (!ref) throw new Error("ComfyUI 沒有回傳影片");
      return comfy.fetchImage(ref);
    };
    const [mp4, first, last] = await Promise.all([get(VIDEO_OUTPUT.video), get(VIDEO_OUTPUT.first), get(VIDEO_OUTPUT.last)]);
    const { width, height } = pngSize(first);
    const video = insertImage(
      {
        id: nanoid(12),
        tool: job.tool,
        media: "video",
        duration: framesFor(job.params.video!.seconds) / 24,
        params: { ...job.params, width, height },
        origin: job.origin,
        parentId: job.params.video?.firstFrameId,
        width,
        height,
        favorite: false,
        createdAt: Date.now(),
      },
      first,
      { mp4, last },
    );
    emit({ type: "image", image: video });
    return video;
  }
  const ref = h?.outputs?.[tool.outputNode]?.images?.[0];
  if (!ref) throw new Error("ComfyUI 沒有回傳圖片");
  let png = await comfy.fetchImage(ref);
  if (finish) {
    update(job, { stage: "貼回原圖" });
    png = await finish(png);
  }
  const { width, height } = pngSize(png);
  const image = insertImage(
    {
      id: nanoid(12),
      tool: job.tool,
      media: "image",
      params: job.params,
      origin: job.origin,
      parentId: job.params.sourceImageId,
      width,
      height,
      favorite: false,
      createdAt: Date.now(),
    },
    png,
  );
  emit({ type: "image", image });
  const batch = job.params.batch;
  if (batch?.saveTo) {
    try {
      saveCopy(batch.saveTo, batch.name ?? image.id, png);
    } catch (e) {
      update(job, { error: `已存進圖庫，但寫不進 ${batch.saveTo}：${e instanceof Error ? e.message : e}` });
    }
  }
  return image;
}

/** Write a batch result as `<name>.png`, without overwriting anything already there. */
function saveCopy(dir: string, name: string, png: Buffer) {
  let file = path.join(dir, `${name}.png`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${name}_${n}.png`);
  fs.writeFileSync(file, png);
}
