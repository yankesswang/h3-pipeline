import path from "node:path";
import type { ChatMessage, PresetPurpose, VideoContext } from "@/lib/shared/types";
import { framesFor } from "@/lib/tools/video";
import { beforeLlmCall, freeComfyForLlm } from "./gpu";
import { listFolder } from "./batch";
import { fileDataUrl, visionDataUrl } from "./images";
import { getImage } from "./repo";
import { getSettings } from "./settings";

// Proxy to any OpenAI-compatible /chat/completions endpoint (LM Studio,
// Ollama, vLLM, OpenAI, OpenRouter...). The browser receives NDJSON lines:
//   {"t":"reasoning","d":"..."}  thinking text, shown dimmed and never used as a prompt
//   {"t":"content","d":"..."}    the answer
//   {"t":"error","d":"..."}

export type LlmChunk = { t: "reasoning" | "content" | "error"; d: string };

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type { VideoContext };
export type LlmMessage = { role: ChatMessage["role"]; content: string | Part[] };


/**
 * The prompts of the clips a video continues, oldest first. A first frame taken
 * from a video's last frame (Continue from last frame) is a child of that video,
 * and that video may itself have started from an earlier clip's last frame.
 */
export function previousClips(firstFrameId: string | undefined, max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let id = firstFrameId;
  while (id && out.length < max && !seen.has(id)) {
    seen.add(id);
    const frame = getImage(id);
    const video = frame?.parentId ? getImage(frame.parentId) : undefined;
    if (video?.media !== "video" || frame?.params.prompt !== "影片最後一幀") break;
    out.unshift(video.params.prompt);
    id = video.params.video?.firstFrameId;
  }
  return out;
}

/** Tells the LLM what came before, so the next clip carries on the same story. */
export function continuityNote(previous: string[]) {
  if (!previous.length) return "";
  const clips = previous.map((p, i) => `Clip ${i + 1}${i === previous.length - 1 ? " (just before this one)" : ""}:\n${p}`).join("\n\n");
  return `[This clip continues the story below. Its first frame is the last frame of the clip just before it.
${clips}

Continuity rules for this clip:
- Same characters with the same look and clothing, same place, same time of day, lighting and mood, unless the idea changes them.
- Start from where the last clip ended (its pose and position) and show the NEXT moment; do not repeat actions that already happened.
- Keep the camera style and the audio world (ambience, music style, voices and their language) consistent; continue sounds that were ongoing.
- Still follow the first-frame rule: do not describe the image again, start with what moves.
- Write a complete prompt of the usual length: describe the new action in concrete detail (who moves, which way, how fast).]`;
}

/** A [Clip: ...] line for the end of the user's message. */
export function clipLine(v: VideoContext, frames: number) {
  const parts = [`${v.seconds} seconds long (${framesFor(v.seconds)} frames at 24 fps)`];
  if (frames === 0 && v.width && v.height) {
    const shape = v.width > v.height * 1.1 ? "landscape" : v.height > v.width * 1.1 ? "portrait" : "square";
    parts.push(`text to video, ${shape} ${v.width}x${v.height}, no image`);
  }
  const keys = frames >= 1 ? (v.keyframes ?? []) : [];
  if (frames >= 1) parts.push("starts from the attached first frame");
  if (keys.length)
    parts.push(
      `must pass through the attached keyframe${keys.length > 1 ? "s" : ""} at ${keys.map((t) => `${t} s`).join(", ")}; describe, in order, the motion from the first frame through each keyframe${frames - 1 - keys.length >= 1 ? " to the end frame" : ""}`,
    );
  if (frames - 1 - keys.length >= 1) parts.push("must end looking like the attached end frame");
  // Small local models drift into the user's language when several images are attached.
  return `[Clip: ${parts.join("; ")}.]\n[Write the prompt in English, whatever language the idea is in, and end with the "Audio:" line.${frames >= 1 ? " Do not describe the first frame again; start with what moves." : ""}]`;
}

/**
 * Attach images to a user message, labelled the way the prompt will refer to
 * them: for editing, image 1 is the one being edited and the rest are
 * references; for video, the first frame and the end frame, then any
 * reference images (`refIds`) that only guide the wording; for a new image,
 * only such reference images.
 */
export async function withImages(
  text: string,
  imageIds: string[],
  purpose?: PresetPurpose,
  refIds: string[] = [],
  /** Video: seconds of the keyframes that follow the first frame in `imageIds`. */
  keyTimes: number[] = [],
): Promise<Part[]> {
  const urls = await Promise.all([...imageIds, ...refIds].map(visionDataUrl));
  const legend =
    purpose === "video"
      ? videoLegend(imageIds.length, refIds.length, keyTimes)
      : purpose === "generate"
      ? `[Attached: ${refIds.length === 1 ? "a reference image" : `${refIds.length} reference images`}. They are not part of the output (the image is made from the text prompt alone); describe in words what the user wants from them: the subject's look, clothing, setting, composition or style.]`
      : imageIds.length === 1
      ? "[The attached image is <image1>, the image being edited.]"
      : `[Attached images, in order: <image1> is the image being edited; ${imageIds
          .slice(1)
          .map((_, i) => `<image${i + 2}>`)
          .join(", ")} ${imageIds.length === 2 ? "is a reference" : "are references"}.]`;
  return [{ type: "text", text: `${text}\n\n${legend}` }, ...urls.map((url) => ({ type: "image_url" as const, image_url: { url } }))];
}

/** At most `max` items spread evenly over the list, first and last included. */
function spread<T>(list: T[], max: number): T[] {
  if (list.length <= max) return list;
  return Array.from({ length: max }, (_, i) => list[Math.round((i * (list.length - 1)) / (max - 1))]);
}

/**
 * Batch edit: a few of the batch's images, so the LLM knows what kind of
 * pictures the one instruction will be applied to.
 */
export async function withBatchSamples(text: string, batch: { folder?: string; imageIds?: string[] }, max = 4): Promise<string | Part[]> {
  let urls: string[];
  let total: number;
  if (batch.folder !== undefined) {
    const { path: dir, images } = listFolder(batch.folder);
    total = images.length;
    urls = await Promise.all(spread(images, max).map((name) => fileDataUrl(path.join(dir, name)).catch(() => "")));
  } else {
    const ids = batch.imageIds ?? [];
    total = ids.length;
    urls = await Promise.all(spread(ids, max).map((id) => visionDataUrl(id).catch(() => "")));
  }
  urls = urls.filter(Boolean);
  if (!urls.length) return text;
  const legend =
    urls.length === total
      ? `[Attached: ${total === 1 ? "the image" : `all ${total} images`} in this batch, so you can see what the instruction will be applied to.]`
      : `[Attached: ${urls.length} sample images out of the ${total} in this batch, so you can see what kind of images the instruction will be applied to.]`;
  return [{ type: "text", text: `${text}\n\n${legend}` }, ...urls.map((url) => ({ type: "image_url" as const, image_url: { url } }))];
}

function videoLegend(frames: number, refs: number, keyTimes: number[]) {
  const keys = frames >= 1 ? keyTimes : [];
  const hasEnd = frames - 1 - keys.length >= 1;
  const story = refs >= 2;
  const order = [
    ...(frames >= 1 ? ["the video's first frame"] : []),
    ...keys.map((t) => `the keyframe at ${t} s`),
    ...(hasEnd ? ["its end frame"] : []),
    ...(refs === 1 ? ["a reference image"] : story ? [`${refs} storyboard photos (photo 1 to photo ${refs})`] : []),
  ];
  const lines = [`[Attached images, in order: ${order.join(", then ")}.]`];
  if (story)
    lines.push(
      frames
        ? `[The storyboard photos are the story in order: the video starts at the first frame, then moves through photo 1, photo 2 … photo ${refs}${hasEnd ? ", and ends on the end frame" : ""}. Write the action as one continuous sequence that follows this order, beat by beat. The photos are not inserted into the video; describe each beat (who, what they do, where, how the camera follows) in words.]`
        : `[The photos are a storyboard, in order: photo 1, photo 2 … photo ${refs}. They are not in the video (it is made from text alone). Write the video as one continuous sequence that moves through them in this order, beat by beat, describing in words the subject's look, the setting and what happens in each. Still write the text-only shape: start with who or what is in the shot.]`,
    );
  else if (refs)
    lines.push(
      frames
        ? "[Reference images are not in the video; use them only for what the user asks about (a character's look, an outfit, a style), described in words.]"
        : "[Reference images are not in the video (it is made from text alone); describe in words what the user wants from them: the subject's look, clothing, setting or style. Still write the text-only shape: start with who or what is in the shot.]",
    );
  return lines.join("\n");
}

function headers() {
  const s = getSettings();
  return {
    "content-type": "application/json",
    ...(s.llmApiKey ? { authorization: `Bearer ${s.llmApiKey}` } : {}),
  };
}

export async function listModels(): Promise<string[]> {
  const s = getSettings();
  const res = await fetch(s.llmBaseUrl.replace(/\/$/, "") + "/models", {
    headers: headers(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => m.id).sort();
}

/** Splits inline <think>...</think> blocks out of a content stream, even when tags straddle chunks. */
class ThinkSplitter {
  private buf = "";
  private inThink = false;

  push(text: string, out: (c: LlmChunk) => void) {
    this.buf += text;
    for (;;) {
      const tag = this.inThink ? "</think>" : "<think>";
      const i = this.buf.indexOf(tag);
      if (i >= 0) {
        this.emit(this.buf.slice(0, i), out);
        this.buf = this.buf.slice(i + tag.length);
        this.inThink = !this.inThink;
        continue;
      }
      // Hold back anything that could be the start of a tag.
      let keep = 0;
      for (let k = Math.min(tag.length - 1, this.buf.length); k > 0; k--) {
        if (tag.startsWith(this.buf.slice(-k))) {
          keep = k;
          break;
        }
      }
      this.emit(this.buf.slice(0, this.buf.length - keep), out);
      this.buf = this.buf.slice(this.buf.length - keep);
      return;
    }
  }

  flush(out: (c: LlmChunk) => void) {
    this.emit(this.buf, out);
    this.buf = "";
  }

  private emit(text: string, out: (c: LlmChunk) => void) {
    if (text) out({ t: this.inThink ? "reasoning" : "content", d: text });
  }
}

export function streamChat(messages: LlmMessage[], signal?: AbortSignal): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const out = (c: LlmChunk) => controller.enqueue(enc.encode(JSON.stringify(c) + "\n"));
      try {
        const s = getSettings();
        const model = s.llmModel || (await loadedModel());
        if (!model) throw new Error("還沒選擇 LLM 模型：到「監控」的模型卡片切換一個 LLM，或到「設定」選一個。");
        await beforeLlmCall();
        let noThinking = s.llmDisableThinking;
        const call = () =>
          fetch(s.llmBaseUrl.replace(/\/$/, "") + "/chat/completions", {
            method: "POST",
            headers: headers(),
            signal,
            body: JSON.stringify({
              model,
              messages,
              temperature: s.llmTemperature,
              stream: true,
              // Writing a prompt does not need a long chain of thought; this makes local models ~10x faster.
              ...(noThinking ? { reasoning_effort: "none" } : {}),
            }),
          });
        let res = await call();
        if (!res.ok && noThinking) {
          const text = await res.clone().text();
          if (/reasoning/i.test(text)) {
            // This endpoint does not accept reasoning_effort; send it without.
            noThinking = false;
            res = await call();
          }
        }
        if (!res.ok) {
          const text = await res.text();
          if (/failed to load model/i.test(text)) {
            if (!(await freeComfyForLlm()))
              throw new Error("LLM 載不進 GPU，而且目前正在生圖，無法釋放 VRAM。請等生圖結束再試。");
            out({ t: "reasoning", d: "（已請 ComfyUI 釋放 VRAM，重新載入 LLM…）\n" });
            // Freeing takes a moment and LM Studio's loader can fail while it does; back off and retry.
            for (let attempt = 1; attempt <= 3; attempt++) {
              await new Promise((r) => setTimeout(r, attempt * 2000));
              res = await call();
              if (res.ok || !/failed to load model/i.test(await res.clone().text())) break;
            }
          } else throw new Error(`LLM 回應 ${res.status}：${text.slice(0, 400)}`);
        }
        if (!res.ok || !res.body) throw new Error(`LLM 回應 ${res.status}：${(await res.text()).slice(0, 400)}`);

        const splitter = new ThinkSplitter();
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let pending = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += value;
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) {
            const data = line.replace(/^data:\s*/, "").trim();
            if (!data || data === "[DONE]" || !line.startsWith("data:")) continue;
            const delta = JSON.parse(data).choices?.[0]?.delta ?? {};
            const reasoning = delta.reasoning_content ?? delta.reasoning;
            if (reasoning) out({ t: "reasoning", d: reasoning });
            if (delta.content) splitter.push(delta.content, out);
          }
        }
        splitter.flush(out);
      } catch (e) {
        if (!signal?.aborted) out({ t: "error", d: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
}

/** With no model chosen in settings, use whatever chat model LM Studio already has loaded. */
async function loadedModel(): Promise<string | undefined> {
  try {
    const base = getSettings().llmBaseUrl.replace(/\/v1\/?$/, "");
    const res = await fetch(`${base}/api/v0/models`, { signal: AbortSignal.timeout(1500) });
    const d = (await res.json()) as { data?: { id: string; type?: string; state?: string }[] };
    return d.data?.find((m) => m.state === "loaded" && m.type !== "embeddings")?.id;
  } catch {
    return undefined;
  }
}

// Appended to the user's own system prompt in chat mode, so the UI can find the
// finished prompt in the reply and offer a "use this prompt" button.
export const chatProtocol = (purpose?: PresetPurpose) => `

---
You are chatting with the user to develop ${purpose === "video" ? "a video clip" : "an image"} idea together. Ask short questions when the idea is unclear, and suggest options.
Whenever you give a complete, ready-to-use prompt or edit instruction, put it inside <prompt>...</prompt> tags, following the prompt-writing rules above. Only one <prompt> block per reply. Reply to the user in the language they write in; the prompt itself follows the rules above.`;
