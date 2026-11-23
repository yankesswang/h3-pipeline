import { clipLine, continuityNote, previousClips, streamChat, withBatchSamples, withImages, type LlmMessage, type VideoContext } from "@/lib/server/llm";
import { getPreset } from "@/lib/server/repo";

// One-shot: the user's idea in, a finished prompt out, using the preset as the
// system prompt. When editing (or making a video from frames) the images go
// along so the LLM can see them; video prompts also get the clip's length and,
// when continuing a clip, the prompts of the clips before it.
export async function POST(req: Request) {
  const b = (await req.json()) as {
    presetId: string;
    idea: string;
    imageIds?: string[];
    /** Video or a new image: images the LLM looks at for wording, not inputs of the model. */
    refImageIds?: string[];
    video?: VideoContext;
    /** Video: set false to leave out the prompts of the clips this one continues. */
    continuity?: boolean;
    /** Batch edit: the images the instruction will go to; the LLM sees a few of them. */
    batch?: { folder?: string; imageIds?: string[] };
  };
  const preset = getPreset(b.presetId);
  if (!preset) return Response.json({ error: "找不到這個範本" }, { status: 404 });
  const ids = b.imageIds ?? [];
  const refs = b.video || preset.purpose === "generate" ? (b.refImageIds ?? []) : [];
  // Continuing from a clip's last frame: the earlier prompts go along so the story carries on.
  const previous = b.video && b.continuity !== false ? previousClips(ids[0]) : [];
  const idea = b.idea.trim() || (previous.length
    ? "Continue the story with the next natural moment."
    : b.video && (ids.length || refs.length)
      ? "Write a video prompt based on the attached images. Infer a natural action and camera movement while respecting the first frame, any keyframes, and the end frame."
      : b.idea);
  const text = b.video
    ? [continuityNote(previous), idea, clipLine(b.video, ids.length)].filter(Boolean).join("\n\n")
    : b.idea;
  const messages: LlmMessage[] = [
    { role: "system", content: preset.content },
    {
      role: "user",
      content: b.batch
        ? await withBatchSamples(text, b.batch)
        : ids.length || refs.length
          ? await withImages(text, ids, preset.purpose, refs, b.video?.keyframes)
          : text,
    },
  ];
  return new Response(streamChat(messages, req.signal), { headers: { "content-type": "application/x-ndjson" } });
}
