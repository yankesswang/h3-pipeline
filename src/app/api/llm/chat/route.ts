import type { ChatMessage } from "@/lib/shared/types";
import { CHAT_PROTOCOL, streamChat, withImages, type LlmMessage } from "@/lib/server/llm";
import { getPreset } from "@/lib/server/repo";

// Conversational prompt building: the preset's system prompt plus a small
// protocol so finished prompts come back inside <prompt> tags. When editing,
// the current images ride along on the latest user message only.
export async function POST(req: Request) {
  const b = (await req.json()) as { presetId: string; messages: ChatMessage[]; imageIds?: string[] };
  const preset = getPreset(b.presetId);
  const history: LlmMessage[] = b.messages.filter((m) => m.role !== "system");
  const last = history.length - 1;
  if (b.imageIds?.length && history[last]?.role === "user")
    history[last] = { role: "user", content: await withImages(history[last].content as string, b.imageIds) };
  const messages: LlmMessage[] = [{ role: "system", content: (preset?.content ?? "") + CHAT_PROTOCOL }, ...history];
  return new Response(streamChat(messages, req.signal), { headers: { "content-type": "application/x-ndjson" } });
}
