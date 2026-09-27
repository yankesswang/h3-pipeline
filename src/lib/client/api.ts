import type {
  ChatMessage,
  CustomTool,
  FieldCandidate,
  GenerateRequest,
  ImageRecord,
  Job,
  LoraInfo,
  Preset,
  Settings,
} from "@/lib/shared/types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export type PublicSettings = Settings & { llmApiKeySet: boolean };
export type ToolDraft = Pick<CustomTool, "name" | "description" | "workflow" | "fields" | "outputNode">;
export const loraPreviewUrl = (name: string) => `/api/loras/preview?name=${encodeURIComponent(name)}`;
export type PresetDraft = Pick<Preset, "name" | "family" | "purpose" | "content">;

export const api = {
  jobs: () => fetch("/api/jobs").then(json<Job[]>),
  generate: (req: GenerateRequest) => fetch("/api/jobs", send("POST", req)).then(json<Job[]>),
  cancelJob: (id: string) => fetch(`/api/jobs/${id}`, send("DELETE")).then(json<void>),

  images: (q: { before?: number; limit?: number; favorites?: boolean; q?: string } = {}) => {
    const sp = new URLSearchParams();
    if (q.before) sp.set("before", String(q.before));
    if (q.limit) sp.set("limit", String(q.limit));
    if (q.favorites) sp.set("favorites", "1");
    if (q.q) sp.set("q", q.q);
    return fetch(`/api/images?${sp}`).then(json<ImageRecord[]>);
  },
  image: (id: string) => fetch(`/api/images/${id}`).then(json<ImageRecord>),
  /** A video's first or last frame as an image of its own. */
  frame: (id: string, which: "first" | "last") =>
    fetch(`/api/images/${id}/frame`, send("POST", { which })).then(json<ImageRecord>),
  tree: (id: string) => fetch(`/api/images/${id}/tree`).then(json<ImageRecord[]>),
  upload: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("file", f);
    return fetch("/api/images/upload", { method: "POST", body: form }).then(json<ImageRecord[]>);
  },
  setFavorite: (id: string, favorite: boolean) =>
    fetch(`/api/images/${id}`, send("PATCH", { favorite })).then(json<ImageRecord>),
  deleteImage: (id: string) => fetch(`/api/images/${id}`, send("DELETE")).then(json<void>),

  presets: () => fetch("/api/presets").then(json<Preset[]>),
  createPreset: (p: PresetDraft) => fetch("/api/presets", send("POST", p)).then(json<Preset>),
  updatePreset: (id: string, p: PresetDraft) =>
    fetch(`/api/presets/${id}`, send("PUT", p)).then(json<Preset>),
  deletePreset: (id: string) => fetch(`/api/presets/${id}`, send("DELETE")).then(json<void>),

  settings: () => fetch("/api/settings").then(json<PublicSettings>),
  saveSettings: (s: Partial<Settings>) => fetch("/api/settings", send("PUT", s)).then(json<PublicSettings>),
  llmModels: () => fetch("/api/llm/models").then(json<{ models: string[]; error?: string }>),
  tools: () => fetch("/api/tools").then(json<{ builtin: { id: string; name: string }[]; custom: CustomTool[] }>),
  tool: (id: string) => fetch(`/api/tools/${id}`).then(json<CustomTool>),
  analyzeWorkflow: (workflow: unknown) =>
    fetch("/api/tools/analyze", send("POST", { workflow })).then(
      json<{
        workflow: CustomTool["workflow"];
        candidates: FieldCandidate[];
        outputs: { id: string; title: string; classType: string }[];
        missing: string[];
      }>,
    ),
  saveTool: (t: ToolDraft, id?: string) =>
    fetch(id ? `/api/tools/${id}` : "/api/tools", send(id ? "PUT" : "POST", t)).then(json<CustomTool>),
  deleteTool: (id: string) => fetch(`/api/tools/${id}`, send("DELETE")).then(json<void>),

  loras: () => fetch("/api/loras").then(json<{ loras: LoraInfo[]; folders: string[]; error?: string }>),
  saveLoraMeta: (name: string, note: string, defaultStrength: number) =>
    fetch("/api/loras/meta", send("PUT", { name, note, defaultStrength })).then(json<void>),

  samReady: () => fetch("/api/sam").then(json<{ ready: boolean; progress: number; error?: string }>),
  sam: (imageId: string, points: [number, number, 0 | 1][]) =>
    fetch("/api/sam", send("POST", { imageId, points })).then(json<{ mask: string; score: number }>),
  status: () => fetch("/api/status").then(json<{ comfy: boolean; llm: boolean; llmModel: string; vramPct: number | null }>),
};

/** Full PNG, or a cached WebP thumbnail when `width` is given. */
export const imageUrl = (id: string, width?: number) => `/api/images/${id}/file${width ? `?w=${width}` : ""}`;

export interface StreamHandlers {
  onContent: (text: string) => void;
  onReasoning?: (text: string) => void;
}

/** POST to an LLM route and feed its NDJSON stream to the handlers. Throws on an error line. */
export async function streamLlm(
  path: "/api/llm/chat" | "/api/llm/expand",
  body: { presetId: string; messages?: ChatMessage[]; idea?: string; imageIds?: string[] },
  h: StreamHandlers,
  signal?: AbortSignal,
) {
  const res = await fetch(path, { ...send("POST", body), signal });
  if (!res.ok || !res.body) await json(res);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const c = JSON.parse(line) as { t: string; d: string };
      if (c.t === "content") h.onContent(c.d);
      else if (c.t === "reasoning") h.onReasoning?.(c.d);
      else if (c.t === "error") throw new Error(c.d);
    }
  }
}

/** Pull the finished prompt out of an assistant reply, if it has one. */
export function extractPrompt(text: string): string | undefined {
  const m = text.match(/<prompt>([\s\S]*?)(<\/prompt>|$)/);
  return m?.[1].trim() || undefined;
}
