import type { ChatMessage } from "@/lib/shared/types";
import { chatProtocol, clipLine, continuityNote, previousClips, streamChat, withImages, type LlmMessage, type VideoContext } from "@/lib/server/llm";
import { getPreset } from "@/lib/server/repo";

// Conversational prompt building: the preset's system prompt plus a small
// protocol so finished prompts come back inside <prompt> tags. When editing,
// the current images ride along on the latest user message only, as does a
// video's clip line.
export async function POST(req: Request) {
  const b = (await req.json()) as { presetId: string; messages: ChatMessage[]; imageIds?: string[]; video?: VideoContext };
  const preset = getPreset(b.presetId);
  const history: LlmMessage[] = b.messages.filter((m) => m.role !== "system");
  const last = history.length - 1;
  const ids = b.imageIds ?? [];
  if (history[last]?.role === "user" && (ids.length || b.video)) {
    const note = b.video ? continuityNote(previousClips(ids[0])) : "";
    const text = b.video
      ? [note, history[last].content, clipLine(b.video, ids.length)].filter(Boolean).join("\n\n")
      : (history[last].content as string);
    history[last] = { role: "user", content: ids.length ? await withImages(text, ids, preset?.purpose, [], b.video?.keyframes) : text };
  }
  const messages: LlmMessage[] = [{ role: "system", content: (preset?.content ?? "") + chatProtocol(preset?.purpose) }, ...history];
  return new Response(streamChat(messages, req.signal), { headers: { "content-type": "application/x-ndjson" } });
}
