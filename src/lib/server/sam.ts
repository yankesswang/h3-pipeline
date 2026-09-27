import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { comfy } from "./comfy";
import { DATA_DIR } from "./db";
import { imagePath } from "./repo";

// Click-to-select runs in a small Python server (sam/sam_server.py) using
// ComfyUI's own Python environment, started on first use and kept running.

const PORT = 8199;
const BASE = `http://127.0.0.1:${PORT}`;
export const SAM_MODEL_DIR = path.join(DATA_DIR, "models", "sam2.1-hiera-small");

const state = ((globalThis as unknown as { __sam?: { proc?: ChildProcess; starting?: Promise<void>; log: string } }).__sam ??=
  { log: "" });

async function healthy() {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

const REPO = "https://huggingface.co/facebook/sam2.1-hiera-small/resolve/main";
const FILES = ["config.json", "preprocessor_config.json", "processor_config.json", "model.safetensors"];
const MODEL_BYTES = 184_305_280;

export function samModelReady() {
  return FILES.every((name) => {
    const f = path.join(SAM_MODEL_DIR, name);
    return fs.existsSync(f) && fs.statSync(f).size >= (name === "model.safetensors" ? MODEL_BYTES : 1);
  });
}

const dl = ((globalThis as unknown as { __samDl?: { running: boolean; error?: string } }).__samDl ??= { running: false });

/** Download progress (0..1) of the one-time model download, starting it if needed. */
export function samDownload(): { ready: boolean; progress: number; error?: string } {
  if (samModelReady()) return { ready: true, progress: 1 };
  if (!dl.running) void download();
  const f = path.join(SAM_MODEL_DIR, "model.safetensors");
  const have = fs.existsSync(f) ? fs.statSync(f).size : 0;
  return { ready: false, progress: have / MODEL_BYTES, error: dl.error };
}

/** Fetch the model files, resuming the big one across dropped connections. */
async function download() {
  dl.running = true;
  dl.error = undefined;
  try {
    fs.mkdirSync(SAM_MODEL_DIR, { recursive: true });
    for (const name of FILES) {
      const file = path.join(SAM_MODEL_DIR, name);
      for (let attempt = 0; ; attempt++) {
        const have = fs.existsSync(file) ? fs.statSync(file).size : 0;
        if (name === "model.safetensors" ? have >= MODEL_BYTES : have > 0) break;
        if (attempt > 30) throw new Error(`下載 ${name} 一直失敗`);
        let out: fs.WriteStream | undefined;
        try {
          const res = await fetch(`${REPO}/${name}`, { headers: have ? { range: `bytes=${have}-` } : {} });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          out = fs.createWriteStream(file, { flags: res.status === 206 ? "a" : "w" });
          for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) out.write(chunk);
          await new Promise((r) => out!.end(r));
        } catch {
          // Keep what arrived; the next attempt resumes from there.
          await new Promise((r) => (out ? out.end(r) : r(undefined)));
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }
  } catch (e) {
    dl.error = e instanceof Error ? e.message : String(e);
  } finally {
    dl.running = false;
  }
}

/** ComfyUI's venv python, found through ComfyUI's own folder list. */
async function pythonPath(): Promise<string> {
  if (process.env.SAM_PYTHON) return process.env.SAM_PYTHON;
  const paths = (await fetch(`${comfy.baseUrl}/internal/folder_paths`).then((r) => r.json())) as Record<string, string[]>;
  const nodes = paths.custom_nodes?.[0];
  if (!nodes) throw new Error("找不到 ComfyUI 的安裝位置");
  const root = path.dirname(nodes);
  for (const cand of [path.join(root, ".venv/bin/python"), path.join(root, "venv/bin/python")])
    if (fs.existsSync(/*turbopackIgnore: true*/ cand)) return cand;
  throw new Error("找不到 ComfyUI 的 Python 環境，請設定 SAM_PYTHON");
}

async function ensureRunning() {
  if (await healthy()) return;
  if (!samModelReady()) throw new Error("SAM 模型還沒下載完成");
  state.starting ??= (async () => {
    const python = await pythonPath();
    state.log = "";
    // The script runs from the project folder; keep the bundler from tracing it.
    const proc = spawn(/*turbopackIgnore: true*/ python, [path.join(/*turbopackIgnore: true*/ process.cwd(), "sam", "sam_server.py")], {
      env: { ...process.env, SAM_MODEL: SAM_MODEL_DIR, SAM_PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const keep = (d: Buffer) => (state.log = (state.log + d.toString()).slice(-4000));
    proc.stdout?.on("data", keep);
    proc.stderr?.on("data", keep);
    proc.on("exit", () => (state.proc = undefined));
    state.proc = proc;
    for (let i = 0; i < 120; i++) {
      if (await healthy()) return;
      if (!state.proc) throw new Error(`SAM 啟動失敗：${state.log.slice(-500)}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("SAM 啟動逾時");
  })().finally(() => (state.starting = undefined));
  await state.starting;
}

export type SamPoint = [x: number, y: number, positive: 0 | 1];

/** Mask (PNG, white = selected) for points in image pixel coordinates. */
export async function segment(imageId: string, points: SamPoint[], box?: [number, number, number, number]) {
  const image = imagePath(imageId);
  if (!image) throw new Error("找不到圖片");
  await ensureRunning();
  const res = await fetch(`${BASE}/segment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image, points, box: box ?? null }),
  });
  const body = (await res.json()) as { mask?: string; score?: number; error?: string };
  if (!res.ok || !body.mask) throw new Error(body.error ?? `SAM ${res.status}`);
  return { mask: `data:image/png;base64,${body.mask}`, score: body.score ?? 0 };
}
