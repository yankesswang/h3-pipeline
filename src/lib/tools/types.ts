// A "tool" is a ComfyUI API-format workflow plus a map from friendly field
// names to the node inputs they fill. Built-in tools and (later) imported
// workflows both use this shape.

export type ApiWorkflow = Record<
  string,
  { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }
>;

export interface ToolField {
  node: string;
  input: string;
}

export interface Tool {
  id: string;
  name: string;
  family: string;
  workflow: ApiWorkflow;
  fields: Record<string, ToolField>;
  /** Node whose images are the tool's result. */
  outputNode: string;
  /**
   * Tools that take a variable number of images: each one gets a LoadImage
   * node wired to `${prefix}${n}` on `node` (n from 1).
   */
  imageInput?: { node: string; prefix: string; max: number };
}

/** `images` are file names already uploaded to ComfyUI's input folder. */
export function buildPrompt(tool: Tool, values: Record<string, unknown>, images: string[] = []): ApiWorkflow {
  const wf: ApiWorkflow = structuredClone(tool.workflow);
  for (const [name, value] of Object.entries(values)) {
    const field = tool.fields[name];
    if (!field || value === undefined) continue;
    const node = wf[field.node];
    if (!node) throw new Error(`Tool ${tool.id}: field ${name} points at missing node ${field.node}`);
    node.inputs[field.input] = value;
  }
  if (images.length) {
    const spec = tool.imageInput;
    if (!spec) throw new Error(`Tool ${tool.id} does not take images`);
    if (images.length > spec.max) throw new Error(`最多 ${spec.max} 張圖`);
    images.forEach((file, i) => {
      const id = `img${i + 1}`;
      wf[id] = { class_type: "LoadImage", inputs: { image: file } };
      wf[spec.node].inputs[`${spec.prefix}${i + 1}`] = [id, 0];
    });
  }
  return wf;
}
