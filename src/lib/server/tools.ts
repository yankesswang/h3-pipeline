import { nanoid } from "nanoid";
import type { CustomField, CustomTool, FieldCandidate, FieldKind, ToolId } from "@/lib/shared/types";
import { builtinTools } from "@/lib/tools/builtin";
import type { ApiWorkflow, Tool } from "@/lib/tools/types";
import { comfy } from "./comfy";
import { db } from "./db";

// Imported workflows: stored as-is (API format) with the fields the user chose
// to expose. At run time they become an ordinary Tool, like the built-ins.

interface ToolRow {
  id: string;
  name: string;
  description: string;
  workflow: string;
  fields: string;
  output_node: string;
  created_at: number;
  updated_at: number;
}

const toTool = (r: ToolRow): CustomTool => ({
  id: r.id,
  name: r.name,
  description: r.description,
  workflow: JSON.parse(r.workflow),
  fields: JSON.parse(r.fields),
  outputNode: r.output_node,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listCustomTools() {
  return (db.prepare("SELECT * FROM tools ORDER BY updated_at DESC").all() as ToolRow[]).map(toTool);
}

export function getCustomTool(id: string) {
  const r = db.prepare("SELECT * FROM tools WHERE id = ?").get(id) as ToolRow | undefined;
  return r ? toTool(r) : undefined;
}

type ToolInput = Pick<CustomTool, "name" | "description" | "workflow" | "fields" | "outputNode">;

function validate(t: ToolInput) {
  if (!t.name?.trim()) throw new Error("請幫工具取個名字");
  if (!t.workflow[t.outputNode]) throw new Error("請選擇輸出圖片的節點");
  for (const f of t.fields) if (!t.workflow[f.node]) throw new Error(`欄位 ${f.label} 指向不存在的節點 ${f.node}`);
}

export function saveCustomTool(t: ToolInput, id?: string): CustomTool {
  validate(t);
  const now = Date.now();
  const row = {
    name: t.name.trim(),
    description: t.description ?? "",
    workflow: JSON.stringify(t.workflow),
    fields: JSON.stringify(t.fields),
    output_node: t.outputNode,
  };
  if (id) {
    const res = db
      .prepare(
        "UPDATE tools SET name=@name, description=@description, workflow=@workflow, fields=@fields, output_node=@output_node, updated_at=@now WHERE id=@id",
      )
      .run({ ...row, now, id });
    if (!res.changes) throw new Error("找不到這個工具");
    return getCustomTool(id)!;
  }
  const newId = nanoid(10);
  db.prepare(
    "INSERT INTO tools (id, name, description, workflow, fields, output_node, created_at, updated_at) VALUES (@id, @name, @description, @workflow, @fields, @output_node, @now, @now)",
  ).run({ ...row, id: newId, now });
  return getCustomTool(newId)!;
}

export function deleteCustomTool(id: string) {
  db.prepare("DELETE FROM tools WHERE id = ?").run(id);
}

/** Any tool id → a runnable Tool. Imported tools expose every field by its key. */
export function resolveTool(id: ToolId): Tool {
  if (!id.startsWith("custom:")) {
    const t = builtinTools[id as keyof typeof builtinTools];
    if (!t) throw new Error(`Unknown tool ${id}`);
    return t;
  }
  const c = getCustomTool(id.slice("custom:".length));
  if (!c) throw new Error("這個工具已經被刪除了");
  return {
    id,
    name: c.name,
    family: "custom",
    workflow: c.workflow as ApiWorkflow,
    outputNode: c.outputNode,
    fields: Object.fromEntries(c.fields.map((f) => [f.key, { node: f.node, input: f.input }])),
  };
}

export function customFields(id: ToolId): CustomField[] {
  if (!id.startsWith("custom:")) return [];
  return getCustomTool(id.slice("custom:".length))?.fields ?? [];
}

// ---- analysing an imported workflow ----------------------------------------

type InputSpec = [unknown, Record<string, unknown>?];
type ObjectInfo = Record<string, { input: { required?: Record<string, InputSpec>; optional?: Record<string, InputSpec> }; output?: string[] }>;

const isLink = (v: unknown) => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";

/** Inputs worth exposing without being asked. */
function suggest(classType: string, input: string, title: string): boolean {
  if (title.startsWith("[UI]")) return true;
  if (classType === "LoadImage" && input === "image") return true;
  if (/CLIPTextEncode|TextEncode/.test(classType) && /^(text|prompt)$/.test(input)) return true;
  if (/KSampler/.test(classType) && ["seed", "noise_seed", "steps", "cfg"].includes(input)) return true;
  if (/EmptyLatent|EmptySD3Latent|EmptyFlux/.test(classType) && ["width", "height"].includes(input)) return true;
  return false;
}

function kindOf(input: string, value: unknown, spec?: InputSpec): Pick<CustomField, "kind" | "min" | "max" | "step" | "options"> {
  const [type, opts = {}] = spec ?? [];
  if (Array.isArray(type)) return { kind: "combo", options: type.map(String) };
  if (type === "COMBO") return { kind: "combo", options: ((opts.options as unknown[]) ?? []).map(String) };
  if (type === "BOOLEAN" || typeof value === "boolean") return { kind: "bool" };
  if (type === "STRING" || typeof value === "string")
    return { kind: opts.multiline || /prompt|text/i.test(input) ? "prompt" : "text" };
  const num = { min: opts.min as number | undefined, max: opts.max as number | undefined, step: opts.step as number | undefined };
  if (/seed/i.test(input)) return { kind: "seed", ...num };
  // Trust ComfyUI's declared type over the value: a FLOAT that happens to be 1 is still a float.
  if (type === "FLOAT") return { kind: "float", ...num };
  if (type === "INT" || Number.isInteger(value)) return { kind: "int", ...num };
  return { kind: "float", ...num };
}

const FRIENDLY: Record<string, string> = {
  prompt: "Prompt",
  text: "Prompt",
  negative_prompt: "負面 prompt",
  width: "寬",
  height: "高",
  seed: "Seed",
  noise_seed: "Seed",
  steps: "Steps",
  cfg: "CFG",
  denoise: "Denoise",
  image: "圖片",
  batch_size: "張數",
  sampler_name: "Sampler",
  scheduler: "Scheduler",
  lora_name: "LoRA",
  strength_model: "LoRA 強度",
};

function labelFor(title: string, classType: string, input: string, primary: boolean) {
  const friendly = FRIENDLY[input] ?? input;
  if (title.startsWith("[UI]")) {
    const ui = title.slice(4).trim();
    return ui && primary ? ui : ui ? `${ui} · ${friendly}` : friendly;
  }
  return title === classType ? friendly : `${title} · ${friendly}`;
}

/** Accept an API-format workflow; explain what to do with the UI format. */
export function parseWorkflow(raw: unknown): ApiWorkflow {
  const wf = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!wf || typeof wf !== "object") throw new Error("這不是 JSON 物件");
  if (Array.isArray((wf as { nodes?: unknown }).nodes))
    throw new Error("這是 ComfyUI 的「一般」workflow 格式。請在 ComfyUI 選單用「Export (API)」匯出 API 格式再貼上。");
  const entries = Object.entries(wf as Record<string, unknown>);
  if (!entries.length || !entries.every(([, n]) => n && typeof n === "object" && "class_type" in (n as object) && "inputs" in (n as object)))
    throw new Error("看不懂這個 workflow：每個節點都需要 class_type 和 inputs（API 格式）。");
  return wf as ApiWorkflow;
}

export async function analyzeWorkflow(wf: ApiWorkflow) {
  const info = (await fetch(`${comfy.baseUrl}/object_info`).then((r) => r.json())) as ObjectInfo;
  const missing = [...new Set(Object.values(wf).map((n) => n.class_type).filter((c) => !info[c]))];
  const candidates: FieldCandidate[] = [];
  for (const [node, n] of Object.entries(wf)) {
    const specs = { ...info[n.class_type]?.input.required, ...info[n.class_type]?.input.optional };
    const title = n._meta?.title ?? n.class_type;
    const widgets = Object.entries(n.inputs).filter(([, v]) => !isLink(v));
    for (const [input, value] of widgets) {
      const k = n.class_type === "LoadImage" && input === "image" ? { kind: "image" as FieldKind } : kindOf(input, value, specs[input]);
      // A [UI] node's title names its main input: its only widget, or its prompt.
      const primary = widgets.length === 1 || /^(prompt|text|image)$/.test(input);
      const label = labelFor(title, n.class_type, input, primary);
      candidates.push({
        key: `${node}.${input}`,
        node,
        input,
        label,
        default: value,
        classType: n.class_type,
        nodeTitle: title,
        suggested: suggest(n.class_type, input, title),
        ...k,
      });
    }
  }
  const outputs = Object.entries(wf)
    .filter(([, n]) => /^(SaveImage|PreviewImage|SaveImageAdvanced)$/.test(n.class_type) || (info[n.class_type]?.output?.length === 0 && /Save|Preview/.test(n.class_type)))
    .map(([id, n]) => ({ id, title: n._meta?.title ?? n.class_type, classType: n.class_type }));
  return { candidates, outputs, missing };
}
