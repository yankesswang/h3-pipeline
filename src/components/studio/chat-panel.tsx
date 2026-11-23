"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Brain, CornerDownLeft, Eraser, Images, Sparkles, Square, X } from "lucide-react";
import { extractPrompt, streamLlm } from "@/lib/client/api";
import type { ChatMessage, PresetPurpose, VideoContext } from "@/lib/shared/types";
import { IconButton, PresetSelect } from "@/components/ui";
import { useStudio } from "@/components/studio-provider";

interface UiMessage extends ChatMessage {
  reasoning?: string;
}

const STORE_KEY = "studio.chat";

/** Conversational prompt building. Finished prompts arrive in <prompt> tags and get action buttons. */
export function ChatPanel({
  presetId,
  setPresetId,
  purpose,
  imageIds,
  video,
  onUsePrompt,
  onClose,
}: {
  presetId: string;
  setPresetId: (id: string) => void;
  purpose: PresetPurpose;
  /** Edit mode: the images the LLM gets to see with the next message. */
  imageIds: string[];
  /** Video mode: the clip's length and size, sent with each message. */
  video?: VideoContext;
  onUsePrompt: (prompt: string, chat: ChatMessage[], generate: boolean) => void;
  /** Phones: the panel covers the page and needs its own close button. */
  onClose?: () => void;
}) {
  const { presets } = useStudio();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE_KEY);
      // Browser storage only exists after hydration, so restoring it has to happen in an effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setMessages(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (!streaming) sessionStorage.setItem(STORE_KEY, JSON.stringify(messages));
    } catch {}
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  const plain = (ms: UiMessage[]): ChatMessage[] => ms.map(({ role, content }) => ({ role, content }));

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setError(undefined);
    setInput("");
    const history = [...messages, { role: "user" as const, content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const patchLast = (fn: (m: UiMessage) => UiMessage) =>
      setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])]);
    try {
      await streamLlm(
        "/api/llm/chat",
        { presetId, messages: plain(history), imageIds, video },
        {
          onContent: (t) => patchLast((m) => ({ ...m, content: m.content + t })),
          onReasoning: (t) => patchLast((m) => ({ ...m, reasoning: (m.reasoning ?? "") + t })),
        },
        ac.signal,
      );
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Drop an empty assistant turn (error or instant abort).
      setMessages((ms) => (ms[ms.length - 1]?.content ? ms : ms.slice(0, -1)));
    }
  }

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-line bg-panel max-md:fixed max-md:inset-x-0 max-md:top-0 max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-md:z-40 max-md:h-auto max-md:w-full max-md:border-l-0">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Sparkles className="size-4 text-accent" />
        <h2 className="font-medium">Prompt 助手</h2>
        <IconButton
          label="清空對話"
          className="ml-auto"
          onClick={() => {
            abortRef.current?.abort();
            setMessages([]);
          }}
          disabled={messages.length === 0}
        >
          <Eraser className="size-4" />
        </IconButton>
        {onClose && (
          <IconButton label="關閉" className="md:hidden" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        )}
      </header>

      <div className="border-b border-line px-4 py-2">
        <PresetSelect presets={presets} purpose={purpose} value={presetId} onChange={setPresetId} className="w-full text-xs" />
        {imageIds.length > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-accent">
            <Images className="size-3.5" />
            {purpose === "video" ? `影片模式：LLM 會看到${imageIds.length > 1 ? "第一幀和結尾幀" : "第一幀"}` : `修改模式：LLM 會看到目前的 ${imageIds.length} 張圖`}
          </p>
        )}
      </div>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mt-8 text-center text-xs leading-relaxed text-faint">
            {purpose === "video" ? (
              <>
                跟 LLM 聊你想拍的影片，
                <br />
                它會寫好畫面、鏡頭運動和一行 Audio 聲音描述。
              </>
            ) : purpose === "edit" ? (
              <>
                跟 LLM 說你想怎麼改這張圖，
                <br />
                它看得到原圖和參考圖，會寫出精確的修圖指令。
              </>
            ) : (
              <>
                跟 LLM 聊你想要的畫面，
                <br />
                它會問問題、給建議，最後產出可直接用的 prompt。
              </>
            )}
            <br />
            <br />
            上方可以切換 system prompt 範本。
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-8 self-end rounded-2xl rounded-br-md bg-accent-strong/20 px-3 py-2 whitespace-pre-wrap">
              {m.content}
            </div>
          ) : (
            <AssistantMessage
              key={i}
              message={m}
              live={streaming && i === messages.length - 1}
              onUse={(prompt, generate) => onUsePrompt(prompt, plain(messages.slice(0, i + 1)), generate)}
            />
          ),
        )}
        {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-xl border border-line bg-raised p-2 focus-within:border-accent">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={purpose === "edit" ? "例如：想讓背景變成下雪的夜晚" : "例如：想做一張賽博龐克風的台北夜市海報"}
            className="flex-1 resize-none bg-transparent px-1 text-sm outline-none placeholder:text-faint"
          />
          {streaming ? (
            <IconButton label="停止" onClick={() => abortRef.current?.abort()}>
              <Square className="size-4" />
            </IconButton>
          ) : (
            <IconButton label="送出" onClick={send} disabled={!input.trim()} className="bg-accent-strong !text-white disabled:bg-transparent">
              <ArrowUp className="size-4" />
            </IconButton>
          )}
        </div>
      </div>
    </aside>
  );
}

function AssistantMessage({
  message,
  live,
  onUse,
}: {
  message: UiMessage;
  live: boolean;
  onUse: (prompt: string, generate: boolean) => void;
}) {
  const prompt = extractPrompt(message.content);
  const promptDone = /<\/prompt>/.test(message.content) || !live;
  // Show the reply with the <prompt> block pulled out into its own card.
  const [before, after] = message.content.split(/<prompt>[\s\S]*?(?:<\/prompt>|$)/);
  const thinking = live && !message.content && !!message.reasoning?.trim();

  return (
    <div className="mr-4 flex flex-col gap-2">
      {message.reasoning?.trim() && (
        <details className="text-xs text-faint" open={!!thinking}>
          <summary className="flex cursor-pointer items-center gap-1 hover:text-muted">
            <Brain className="size-3" /> {thinking ? "思考中…" : "思考過程"}
          </summary>
          <p className="mt-1 max-h-40 overflow-y-auto border-l border-line pl-2 whitespace-pre-wrap">{message.reasoning}</p>
        </details>
      )}
      {before?.trim() && <div className="whitespace-pre-wrap leading-relaxed">{before.trim()}</div>}
      {prompt && (
        <div className="rounded-xl border border-accent/40 bg-accent-strong/10 p-3">
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{prompt}</p>
          {promptDone && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => onUse(prompt, false)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-raised hover:text-fg"
              >
                <CornerDownLeft className="size-3" /> 放進輸入框
              </button>
              <button
                onClick={() => onUse(prompt, true)}
                className="flex items-center gap-1 rounded-md bg-accent-strong px-2 py-1 text-xs text-white hover:bg-accent"
              >
                <Sparkles className="size-3" /> 直接執行
              </button>
            </div>
          )}
        </div>
      )}
      {after?.trim() && <div className="whitespace-pre-wrap leading-relaxed">{after.trim()}</div>}
      {live && !message.content && !message.reasoning && <div className="shimmer h-4 w-24 rounded" />}
    </div>
  );
}
