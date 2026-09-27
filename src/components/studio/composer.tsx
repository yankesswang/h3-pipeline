"use client";

import { useRef, useState } from "react";
import { Dices, Lock, Loader2, SlidersHorizontal, Square, Undo2, Wand2 } from "lucide-react";
import { streamLlm } from "@/lib/client/api";
import { ASPECTS, MEGAPIXELS, QUALITIES, randomSeed, sizeFor } from "@/lib/shared/sizes";
import { Button, Chip, IconButton, PresetSelect, inputCls } from "@/components/ui";
import { useStudio } from "@/components/studio-provider";
import type { ComposerState } from "./composer-state";

export function Composer({
  state,
  setState,
  presetId,
  setPresetId,
  onGenerate,
  busy,
}: {
  state: ComposerState;
  setState: (fn: (s: ComposerState) => ComposerState) => void;
  presetId: string;
  setPresetId: (id: string) => void;
  onGenerate: () => void;
  busy: boolean;
}) {
  const { presets, status } = useStudio();
  const [advanced, setAdvanced] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const set = (patch: Partial<ComposerState>) => setState((s) => ({ ...s, ...patch }));
  const { width, height } = sizeFor(state.aspect, state.megapixels);
  const preset = presets.find((p) => p.id === presetId);

  async function expand() {
    const idea = state.origin?.idea && !state.prompt.trim() ? state.origin.idea : state.prompt.trim();
    if (!idea || !preset) return;
    setError(undefined);
    setExpanding(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let out = "";
    set({ prompt: "" });
    try {
      await streamLlm(
        "/api/llm/expand",
        { presetId, idea },
        { onContent: (t) => set({ prompt: (out += t).trimStart() }) },
        ac.signal,
      );
      set({
        prompt: out.trim(),
        origin: {
          idea,
          presetId: preset.id,
          presetName: preset.name,
          systemPrompt: preset.content,
          llmModel: status?.llmModel,
        },
      });
    } catch (e) {
      if (!ac.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
        set({ prompt: idea });
      }
    } finally {
      setExpanding(false);
      abortRef.current = null;
    }
  }

  const quality = QUALITIES.find((q) => q.steps === state.steps);

  return (
    <div className="rounded-2xl border border-line bg-panel p-3 shadow-2xl shadow-black/40">
      {state.origin?.idea && state.origin.idea !== state.prompt && !expanding && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-raised/60 px-3 py-1.5 text-xs text-muted">
          <span className="shrink-0 text-faint">原始想法</span>
          <span className="truncate">{state.origin.idea}</span>
          <button
            className="ml-auto flex shrink-0 items-center gap-1 hover:text-fg"
            onClick={() => set({ prompt: state.origin!.idea!, origin: undefined })}
          >
            <Undo2 className="size-3" /> 還原
          </button>
        </div>
      )}

      <textarea
        value={state.prompt}
        onChange={(e) => set({ prompt: e.target.value, ...(e.target.value ? {} : { origin: undefined }) })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onGenerate();
          }
        }}
        rows={4}
        placeholder="想要什麼畫面？用任何語言描述，按「擴寫」讓 LLM 寫成完整 prompt，或直接生成。（Ctrl+Enter 生成）"
        className="block w-full resize-none bg-transparent px-1 text-[15px] leading-relaxed text-fg outline-none placeholder:text-faint"
      />

      {error && <p className="mt-1 px-1 text-xs text-bad">{error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-raised p-0.5">
          {expanding ? (
            <Button variant="ghost" className="!py-1" onClick={() => abortRef.current?.abort()}>
              <Square className="size-3.5" /> 停止
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="!py-1 text-accent hover:text-accent"
              onClick={expand}
              disabled={!state.prompt.trim() && !state.origin?.idea}
              title="用選定的 system prompt 把想法擴寫成完整 prompt"
            >
              <Wand2 className="size-4" /> 擴寫
            </Button>
          )}
          <PresetSelect
            presets={presets}
            value={presetId}
            onChange={setPresetId}
            className="!border-0 !bg-transparent !py-1 text-xs"
          />
        </div>

        <div className="mx-1 h-5 w-px bg-line" />

        <div className="flex items-center">
          {ASPECTS.map((a) => (
            <Chip key={a.id} on={state.aspect === a.id} onClick={() => set({ aspect: a.id })}>
              {a.id}
            </Chip>
          ))}
        </div>

        <div className="flex items-center">
          {MEGAPIXELS.map((m) => (
            <Chip key={m.id} on={state.megapixels === m.id} onClick={() => set({ megapixels: m.id })}>
              {m.label}
            </Chip>
          ))}
        </div>

        <div className="flex items-center">
          {QUALITIES.map((q) => (
            <Chip key={q.id} on={state.steps === q.steps} onClick={() => set({ steps: q.steps })}>
              {q.label}
            </Chip>
          ))}
        </div>

        <IconButton label="進階參數" onClick={() => setAdvanced((v) => !v)} className={advanced ? "text-accent" : ""}>
          <SlidersHorizontal className="size-4" />
        </IconButton>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-faint tabular-nums">
            {width}×{height}
            {!quality && ` · ${state.steps} steps`}
          </span>
          <div className="flex items-center rounded-lg border border-line text-xs">
            <button className="px-2 py-1 text-muted hover:text-fg" onClick={() => set({ count: Math.max(1, state.count - 1) })}>
              −
            </button>
            <span className="w-8 text-center tabular-nums" title="張數">
              ×{state.count}
            </span>
            <button className="px-2 py-1 text-muted hover:text-fg" onClick={() => set({ count: Math.min(8, state.count + 1) })}>
              +
            </button>
          </div>
          <Button variant="primary" onClick={onGenerate} disabled={!state.prompt.trim() || expanding} className="px-5">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            生成
          </Button>
        </div>
      </div>

      {advanced && (
        <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-muted">
          <label>Steps</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={4}
              max={80}
              value={state.steps}
              onChange={(e) => set({ steps: Number(e.target.value) })}
              className="w-60 accent-accent-strong"
            />
            <span className="tabular-nums text-fg">{state.steps}</span>
            <span className="text-faint">官方建議 40–50</span>
          </div>
          <label>CFG</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={state.cfg}
              onChange={(e) => set({ cfg: Number(e.target.value) })}
              className="w-60 accent-accent-strong"
            />
            <span className="tabular-nums text-fg">{state.cfg}</span>
            <span className="text-faint">保持 1；要用負面 prompt 才調高（會變慢一倍）</span>
          </div>
          <label>Seed</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={state.seed}
              onChange={(e) => set({ seed: Number(e.target.value), seedLocked: true })}
              className={`${inputCls} !w-48 !py-1 font-mono text-xs`}
            />
            <IconButton label="換一個 seed" onClick={() => set({ seed: randomSeed() })}>
              <Dices className="size-4" />
            </IconButton>
            <Button
              variant="ghost"
              className={`!px-2 !py-1 text-xs ${state.seedLocked ? "text-accent" : ""}`}
              onClick={() => set({ seedLocked: !state.seedLocked })}
            >
              <Lock className="size-3.5" />
              {state.seedLocked ? "固定 seed" : "每次隨機"}
            </Button>
          </div>
          <label>負面 prompt</label>
          <input
            value={state.negativePrompt}
            onChange={(e) => set({ negativePrompt: e.target.value })}
            placeholder={state.cfg <= 1 ? "CFG = 1 時不會生效" : "不想出現的東西"}
            className={`${inputCls} !py-1`}
          />
        </div>
      )}
    </div>
  );
}
