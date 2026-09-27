import type { ChatMessage } from "@/lib/shared/types";
import { CHAT_PROTOCOL, streamChat } from "@/lib/server/llm";
import { getPreset } from "@/lib/server/repo";

// Conversational prompt building: the preset's system prompt plus a small
// protocol so finished prompts come back inside <prompt> tags.
export async function POST(req: Request) {
  const b = (await req.json()) as { presetId: string; messages: ChatMessage[] };
  const preset = getPreset(b.presetId);
  const system = (preset?.content ?? "") + CHAT_PROTOCOL;
  const messages: ChatMessage[] = [{ role: "system", content: system }, ...b.messages.filter((m) => m.role !== "system")];
  return new Response(streamChat(messages, req.signal), { headers: { "content-type": "application/x-ndjson" } });
}
