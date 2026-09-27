import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import type { ApiWorkflow } from "@/lib/tools/types";
import { getSettings } from "./settings";

// Thin client for ComfyUI's HTTP + websocket API. One websocket per server
// process; messages are re-emitted keyed by prompt_id.

export interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

type ComfyMessage =
  | { type: "progress"; data: { value: number; max: number; prompt_id: string; node: string } }
  | { type: "executing"; data: { node: string | null; prompt_id: string } }
  | { type: "execution_success"; data: { prompt_id: string } }
  | { type: "execution_error"; data: { prompt_id: string; exception_message: string; node_type: string } }
  | { type: "execution_interrupted"; data: { prompt_id: string } };

class ComfyClient {
  readonly clientId = nanoid();
  readonly events = new EventEmitter();
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;

  get baseUrl() {
    return getSettings().comfyUrl.replace(/\/$/, "");
  }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const url = this.baseUrl.replace(/^http/, "ws") + `/ws?clientId=${this.clientId}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return; // binary preview frames
      try {
        const msg = JSON.parse(ev.data) as ComfyMessage;
        const pid = (msg.data as { prompt_id?: string })?.prompt_id;
        if (pid) this.events.emit(pid, msg);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      this.ws = undefined;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };
    ws.onerror = () => ws.close();
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
    if (!res.ok) throw new Error(`ComfyUI ${path} → ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async submit(prompt: ApiWorkflow): Promise<string> {
    this.connect();
    const res = await this.req<{ prompt_id: string; node_errors?: Record<string, unknown> }>("/prompt", {
      method: "POST",
      body: JSON.stringify({ prompt, client_id: this.clientId }),
    });
    if (res.node_errors && Object.keys(res.node_errors).length)
      throw new Error("ComfyUI 拒絕了 workflow：" + JSON.stringify(res.node_errors).slice(0, 500));
    return res.prompt_id;
  }

  /** Upload to ComfyUI's input folder; returns the name LoadImage should use. */
  async upload(data: Buffer, name: string): Promise<string> {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(data)], { type: "image/png" }), name);
    form.append("subfolder", "comfy-studio");
    form.append("overwrite", "true");
    const res = await fetch(`${this.baseUrl}/upload/image`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`ComfyUI /upload/image → ${res.status}`);
    const body = (await res.json()) as { name: string; subfolder: string };
    return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
  }

  async history(promptId: string) {
    const h = await this.req<
      Record<
        string,
        {
          status: { status_str: string; completed: boolean; messages?: [string, Record<string, unknown>][] };
          outputs: Record<string, { images?: ComfyImageRef[] }>;
        }
      >
    >(`/history/${promptId}`);
    return h[promptId];
  }

  async fetchImage(ref: ComfyImageRef): Promise<Buffer> {
    const q = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder, type: ref.type });
    const res = await fetch(`${this.baseUrl}/view?${q}`);
    if (!res.ok) throw new Error(`ComfyUI /view → ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async interrupt(promptId: string) {
    await this.req("/interrupt", { method: "POST", body: JSON.stringify({ prompt_id: promptId }) });
  }

  async free() {
    await this.req("/free", { method: "POST", body: JSON.stringify({ unload_models: true, free_memory: true }) });
  }

  async ping(): Promise<boolean> {
    try {
      await this.req("/system_stats", { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      return false;
    }
  }
}

const g = globalThis as unknown as { __comfy?: ComfyClient };
export const comfy = (g.__comfy ??= new ComfyClient());
export type { ComfyMessage };
