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
}

export function buildPrompt(tool: Tool, values: Record<string, unknown>): ApiWorkflow {
  const wf: ApiWorkflow = structuredClone(tool.workflow);
  for (const [name, value] of Object.entries(values)) {
    const field = tool.fields[name];
    if (!field || value === undefined) continue;
    const node = wf[field.node];
    if (!node) throw new Error(`Tool ${tool.id}: field ${name} points at missing node ${field.node}`);
    node.inputs[field.input] = value;
  }
  return wf;
}
