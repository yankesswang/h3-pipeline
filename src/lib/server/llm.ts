import type { ChatMessage } from "@/lib/shared/types";
import { beforeLlmCall, freeComfyForLlm } from "./gpu";
import { visionDataUrl } from "./images";
import { getSettings } from "./settings";

// Proxy to any OpenAI-compatible /chat/completions endpoint (LM Studio,
// Ollama, vLLM, OpenAI, OpenRouter...). The browser receives NDJSON lines:
//   {"t":"reasoning","d":"..."}  thinking text, shown dimmed and never used as a prompt
//   {"t":"content","d":"..."}    the answer
//   {"t":"error","d":"..."}

export type LlmChunk = { t: "reasoning" | "content" | "error"; d: string };

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type LlmMessage = { role: ChatMessage["role"]; content: string | Part[] };

/**
 * Attach images to a user message, labelled the way edit instructions refer to
 * them: image 1 is the one being edited, the rest are references.
 */
export async function withImages(text: string, imageIds: string[]): Promise<Part[]> {
  const urls = await Promise.all(imageIds.map(visionDataUrl));
  const legend =
    imageIds.length === 1
      ? "[The attached image is <image1>, the image being edited.]"
      : `[Attached images, in order: <image1> is the image being edited; ${imageIds
          .slice(1)
          .map((_, i) => `<image${i + 2}>`)
          .join(", ")} ${imageIds.length === 2 ? "is a reference" : "are references"}.]`;
  return [{ type: "text", text: `${text}\n\n${legend}` }, ...urls.map((url) => ({ type: "image_url" as const, image_url: { url } }))];
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
        if (!s.llmModel) throw new Error("還沒選擇 LLM 模型，請到「設定」選一個。");
        await beforeLlmCall();
        let noThinking = s.llmDisableThinking;
        const call = () =>
          fetch(s.llmBaseUrl.replace(/\/$/, "") + "/chat/completions", {
            method: "POST",
            headers: headers(),
            signal,
            body: JSON.stringify({
              model: s.llmModel,
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
            res = await call();
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

// Appended to the user's own system prompt in chat mode, so the UI can find the
// finished prompt in the reply and offer a "use this prompt" button.
export const CHAT_PROTOCOL = `

---
You are chatting with the user to develop an image idea together. Ask short questions when the idea is unclear, and suggest options.
Whenever you give a complete, ready-to-use prompt or edit instruction, put it inside <prompt>...</prompt> tags, following the prompt-writing rules above. Only one <prompt> block per reply. Reply to the user in the language they write in; the prompt itself follows the rules above.`;
