import { streamChat, withImages, type LlmMessage } from "@/lib/server/llm";
import { getPreset } from "@/lib/server/repo";

// One-shot: the user's idea in, a finished prompt out, using the preset as the
// system prompt. When editing, the images go along so the LLM can see them.
export async function POST(req: Request) {
  const b = (await req.json()) as { presetId: string; idea: string; imageIds?: string[] };
  const preset = getPreset(b.presetId);
  if (!preset) return Response.json({ error: "找不到這個範本" }, { status: 404 });
  const messages: LlmMessage[] = [
    { role: "system", content: preset.content },
    { role: "user", content: b.imageIds?.length ? await withImages(b.idea, b.imageIds) : b.idea },
  ];
  return new Response(streamChat(messages, req.signal), { headers: { "content-type": "application/x-ndjson" } });
}
