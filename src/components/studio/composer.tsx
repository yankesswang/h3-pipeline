"use client";

import { useRef, useState } from "react";
import { Clapperboard, Dices, Image as ImageIcon, ImagePlus, Lock, Loader2, Plus, SlidersHorizontal, Square, Undo2, Upload, Wand2, X } from "lucide-react";
import { imageUrl, streamLlm } from "@/lib/client/api";
import { ASPECTS, CUSTOM_SIZE, MEGAPIXELS, QUALITIES, randomSeed, snapSize } from "@/lib/shared/sizes";
import { IMAGE_MODELS, type ImageModel, type ImageRecord, type PromptOrigin } from "@/lib/shared/types";
import { Button, Chip, IconButton, PresetSelect, inputCls } from "@/components/ui";
import { useStudio } from "@/components/studio-provider";
import { addRefs, editImageIds, imageSize, initialComposer, videoContext, MAX_REFS, purposeOf, setMode, setModel, videoDims, type ComposerState } from "./composer-state";
import { H3_STEPS } from "@/lib/tools/h3-image";
import { framesFor, VIDEO_SPEEDS, videoEstimate } from "@/lib/tools/video";
import { SamplerRows, VideoQualityChips, VideoStepRows } from "./sampler-fields";
import { LoraPicker } from "./lora-picker";

export function Composer({
  state,
  setState,
  presetId,
  setPresetId,
  onGenerate,
  onUpload,
  region,
  busy,
  autoExpand,
  setAutoExpand,
}: {
  state: ComposerState;
  setState: (fn: (s: ComposerState) => ComposerState) => void;
  presetId: string;
  setPresetId: (id: string) => void;
  /** With an override, generate from this prompt (just written by the LLM) instead of the composer's. */
  onGenerate: (override?: { prompt: string; origin: PromptOrigin }) => void;
  /** Upload outside images; in edit mode they become references, otherwise the first becomes the edit target. */
  onUpload: (files: File[]) => void;
  /** Edit mode: what the instruction applies to. */
  region: "whole" | "mask" | "outpaint";
  busy: boolean;
  /** Run the typed text through the LLM before generating. */
  autoExpand: boolean;
  setAutoExpand: (on: boolean) => void;
}) {
  const { presets, status } = useStudio();
  const [advanced, setAdvanced] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<ComposerState>) => setState((s) => ({ ...s, ...patch }));
  const video = state.mode === "video";
  const editing = !video && !!state.edit;
  // H3 Image is distilled: fixed steps and CFG, no LoRA, no negative prompt.
  const h3 = !video && state.model === "h3-image";
  const o = state.edit?.outpaint;
  const { width, height } = video
    ? videoDims(state)
    : editing
      ? { width: state.edit!.source.width + (o ? o.left + o.right : 0), height: state.edit!.source.height + (o ? o.top + o.bottom : 0) }
      : imageSize(state);
  const setVideo = (patch: Partial<ComposerState["video"]>) => setState((s) => ({ ...s, video: { ...s.video, ...patch } }));
  const aspectWH = ASPECTS.find((a) => a.id === state.aspect) ?? ASPECTS[0];
  const outpainting = editing && region === "outpaint";
  const canRun = !!state.prompt.trim() || (outpainting && !!o && o.left + o.top + o.right + o.bottom > 0);
  const frames = framesFor(state.video.seconds);
  const purpose = purposeOf(state);
  const preset = presets.find((p) => p.id === presetId);
  // A prompt the LLM already wrote (expanded, from the assistant, or reused) is not expanded again.
  const willExpand = autoExpand && !state.origin && !!state.prompt.trim() && !!preset;

  /** Returns the finished prompt, or nothing when it failed or was stopped. */
  async function expand(): Promise<{ prompt: string; origin: PromptOrigin } | undefined> {
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
        { presetId, idea, imageIds: editImageIds(state), video: videoContext(state) },
        { onContent: (t) => set({ prompt: (out += t).trimStart() }) },
        ac.signal,
      );
      const result = {
        prompt: out.trim(),
        origin: {
          idea,
          presetId: preset.id,
          presetName: preset.name,
          systemPrompt: preset.content,
          llmModel: status?.llmModel,
        },
      };
      set(result);
      return result.prompt ? result : undefined;
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

  /** Generate, expanding the text with the LLM first when auto expand is on. */
  async function run() {
    if (!willExpand) return onGenerate();
    const result = await expand();
    if (result) onGenerate(result);
  }

  /** Put "<imageN>" at the cursor, so instructions can point at a specific image. */
  function insertToken(n: number) {
    const el = textRef.current;
    const token = `<image${n}>`;
    const start = el?.selectionStart ?? state.prompt.length;
    const end = el?.selectionEnd ?? start;
    const next = state.prompt.slice(0, start) + token + state.prompt.slice(end);
    set({ prompt: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const quality = QUALITIES.find((q) => q.steps === state.steps);

  return (
    <div className="rounded-2xl border border-line bg-panel p-3 shadow-2xl shadow-black/40">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onUpload(files);
        }}
      />

      {video && (
        <VideoFrames
          state={state}
          setState={setState}
          onUploadClick={() => fileRef.current?.click()}
        />
      )}

      {editing && (
        <EditTargets
          state={state}
          onInsert={insertToken}
          onRemoveRef={(id) => setState((s) => (s.edit ? { ...s, edit: { ...s.edit, refs: s.edit.refs.filter((r) => r.id !== id) } } : s))}
          onAddRefs={(imgs) => setState((s) => addRefs(s, imgs))}
          onUploadClick={() => fileRef.current?.click()}
          onExit={() => set({ edit: undefined, prompt: "", origin: undefined })}
        />
      )}

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
        ref={textRef}
        value={state.prompt}
        onChange={(e) => set({ prompt: e.target.value, ...(e.target.value ? {} : { origin: undefined }) })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!expanding) run();
          }
        }}
        rows={editing || video ? 3 : 4}
        placeholder={
          video
            ? state.video.first
              ? "從第一幀開始，接下來發生什麼？鏡頭怎麼動？最後一行可以寫「Audio: …」描述聲音。按「擴寫」讓 LLM 看圖寫好。"
              : "描述影片：誰在做什麼、鏡頭怎麼動。最後一行可以寫「Audio: …」描述聲音，H3 會一起生成。（Ctrl+Enter 生成）"
            : outpainting
            ? "（選填）描述延伸出去的部分要有什麼，例如「左邊多一棵櫻花樹」。留空就讓模型自然延伸。"
            : region === "mask"
              ? "選取範圍要改成什麼？例如「換成一隻橘貓」「移除這個人」。（Ctrl+Enter 送出）"
              : editing
            ? "要怎麼改？例如「把天空換成夕陽」「讓她穿上 <image2> 的外套」。用中文也可以，按「擴寫」讓 LLM 看圖寫成精確指令。（Ctrl+Enter 送出）"
            : "想要什麼畫面？用任何語言描述，按「擴寫」讓 LLM 寫成完整 prompt，或直接生成。也可以把圖片拖進來修改。（Ctrl+Enter 生成）"
        }
        className="block w-full resize-none bg-transparent px-1 text-[15px] leading-relaxed text-fg outline-none placeholder:text-faint"
      />

      {error && <p className="mt-1 px-1 text-xs text-bad">{error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg bg-raised p-0.5" role="tablist">
          {(
            [
              ["image", "圖片", ImageIcon],
              ["video", "影片", Clapperboard],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              onClick={() => setState((s) => setMode(s, m))}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition ${
                state.mode === m ? "bg-accent-strong text-white" : "text-muted hover:text-fg"
              }`}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        {!video && (
          <div className="flex items-center rounded-lg bg-raised p-0.5" role="tablist" aria-label="圖片模型">
            {(Object.keys(IMAGE_MODELS) as ImageModel[]).map((m) => (
              <button
                key={m}
                onClick={() => setState((s) => setModel(s, m))}
                title={IMAGE_MODELS[m].hint}
                className={`rounded-md px-2.5 py-1 text-xs transition ${
                  state.model === m ? "bg-accent-strong text-white" : "text-muted hover:text-fg"
                }`}
              >
                {IMAGE_MODELS[m].label}
              </button>
            ))}
          </div>
        )}
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
              title={editing ? "讓 LLM 看圖，把你的描述寫成精確的修圖指令" : "用選定的 system prompt 把想法擴寫成完整 prompt"}
            >
              <Wand2 className="size-4" /> 擴寫
            </Button>
          )}
          <PresetSelect
            presets={presets}
            purpose={purpose}
            value={presetId}
            onChange={setPresetId}
            className="!border-0 !bg-transparent !py-1 text-xs"
          />
          <label
            className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs transition ${
              autoExpand ? "text-accent" : "text-muted hover:text-fg"
            }`}
            title="開啟後，按「生成」會先用 LLM 把你的描述擴寫成完整 prompt 再生成；LLM 已寫好的 prompt 不會再擴寫"
          >
            <input
              type="checkbox"
              checked={autoExpand}
              onChange={(e) => setAutoExpand(e.target.checked)}
              className="accent-accent-strong"
            />
            自動擴寫
          </label>
        </div>

        <div className="mx-1 h-5 w-px bg-line" />

        {video ? (
          <>
            {!state.video.first && (
              <div className="flex items-center">
                {ASPECTS.map((a) => (
                  <Chip key={a.id} on={state.aspect === a.id} onClick={() => set({ aspect: a.id })}>
                    {a.id}
                  </Chip>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2 text-xs text-muted" title={`${frames} 幀 @ 24fps`}>
              長度
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={state.video.seconds}
                onChange={(e) => setState((s) => ({ ...s, video: { ...s.video, seconds: Number(e.target.value) } }))}
                className="w-24 accent-accent-strong"
              />
              <span className="w-12 text-fg tabular-nums">{(frames / 24).toFixed(1)} 秒</span>
            </label>
            <VideoQualityChips
              megapixels={state.video.megapixels}
              aspect={state.video.first ? [state.video.first.width, state.video.first.height] : [aspectWH.w, aspectWH.h]}
              onChange={(megapixels) => setVideo({ megapixels })}
            />
          </>
        ) : editing ? (
          <span className={`rounded-md px-2 py-1 text-xs ${region === "whole" ? "text-faint" : "bg-accent-strong/20 text-accent"}`}>
            {region === "mask" ? "只改選取範圍" : region === "outpaint" ? "擴圖" : h3 ? "整張修改" : "整張修改 · 尺寸跟原圖一樣"}
          </span>
        ) : (
          <>
            {state.customSize ? (
              <CustomSize size={state.customSize} onChange={(customSize) => set({ customSize })} />
            ) : (
              <>
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
              </>
            )}
            <Chip
              on={!!state.customSize}
              onClick={() => set({ customSize: state.customSize ? null : { width, height } })}
            >
              {state.customSize ? "改回比例" : "自訂尺寸"}
            </Chip>
          </>
        )}

        {!video && !h3 && (
          <div className="flex items-center">
            {QUALITIES.map((q) => (
              <Chip key={q.id} on={state.steps === q.steps} onClick={() => set({ steps: q.steps })}>
                {q.label}
              </Chip>
            ))}
          </div>
        )}

        <IconButton label="進階參數與 LoRA" onClick={() => setAdvanced((v) => !v)} className={advanced ? "text-accent" : ""}>
          <SlidersHorizontal className="size-4" />
        </IconButton>
        {state.loras.length > 0 && !advanced && !video && !h3 && (
          <button onClick={() => setAdvanced(true)} className="rounded-md bg-accent-strong/20 px-2 py-1 text-xs text-accent">
            LoRA ×{state.loras.length}
          </button>
        )}
 {!editing && !video && (
          <IconButton label="上傳圖片來修改" onClick={() => fileRef.current?.click()}>
            <ImagePlus className="size-4" />
          </IconButton>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-faint tabular-nums">
            {width}×{height}
            {video
              ? ` · 約 ${videoEstimate(state.video.seconds, state.video.megapixels, state.video.steps)} 秒`
              : h3
                ? ` · ${H3_STEPS} 步`
                : !quality && ` · ${state.steps} steps`}
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
          <Button
            variant="primary"
            onClick={run}
            disabled={!canRun || expanding}
            className="px-5"
            title={willExpand ? "先用 LLM 擴寫，再生成" : undefined}
          >
            {busy || expanding ? <Loader2 className="size-4 animate-spin" /> : willExpand ? <Wand2 className="size-4" /> : null}
            {willExpand ? "擴寫並" : ""}
            {video ? "生成影片" : outpainting ? "擴圖" : editing ? "修改" : "生成"}
          </Button>
        </div>
      </div>

      {advanced && (
        <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t md:gap-x-4 border-line pt-3 text-xs text-muted">
          {h3 && (
            <>
              <label>模型</label>
              <span className="text-faint">H3 Image 是蒸餾模型：固定 {H3_STEPS} 步、CFG 1，不支援 LoRA 和負面 prompt。</span>
            </>
          )}
          {!video && !h3 && (
            <>
          <label>Steps</label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <input
              type="range"
              min={4}
              max={80}
              value={state.steps}
              onChange={(e) => set({ steps: Number(e.target.value) })}
              className="w-32 accent-accent-strong sm:w-60"
            />
            <span className="tabular-nums text-fg">{state.steps}</span>
            <span className="text-faint">官方建議 40–50</span>
          </div>
          <label>CFG</label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={state.cfg}
              onChange={(e) => set({ cfg: Number(e.target.value) })}
              className="w-32 accent-accent-strong sm:w-60"
            />
            <span className="tabular-nums text-fg">{state.cfg}</span>
            <span className="text-faint">保持 1；要用負面 prompt 才調高（會變慢一倍）</span>
          </div>
          <SamplerRows
            sampler={state.sampler}
            scheduler={state.scheduler}
            defaults={initialComposer}
            hint="官方：euler + simple"
            onChange={set}
          />
          {editing && region !== "outpaint" && (
            <>
              <label>重繪強度</label>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={state.denoise}
                  onChange={(e) => set({ denoise: Number(e.target.value) })}
                  className="w-32 accent-accent-strong sm:w-60"
                />
                <span className="tabular-nums text-fg">{state.denoise.toFixed(2)}</span>
                <span className="text-faint">1 = 照指令完整重畫；調低會保留更多原圖的構圖和細節</span>
              </div>
            </>
          )}
            </>
          )}
          {video && (
            <>
              <VideoStepRows speed={state.video.speed} steps={state.video.steps} onChange={setVideo} />
              {!VIDEO_SPEEDS[state.video.speed].adapter && (
                <SamplerRows
                  sampler={state.video.sampler}
                  scheduler={state.video.scheduler}
                  defaults={initialComposer.video}
                  hint="官方：res_multistep + simple"
                  onChange={setVideo}
                />
              )}
            </>
          )}
          <label>Seed</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              value={state.seed}
              onChange={(e) => set({ seed: Number(e.target.value), seedLocked: true })}
              className={`${inputCls} !w-32 sm:!w-48 !py-1 font-mono text-xs`}
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
          {!video && !h3 && (
            <>
              <label>LoRA</label>
              <LoraPicker value={state.loras} onChange={(loras) => set({ loras })} />
              <label>負面 prompt</label>
              <input
                value={state.negativePrompt}
                onChange={(e) => set({ negativePrompt: e.target.value })}
                placeholder={state.cfg <= 1 ? "CFG = 1 時不會生效" : "不想出現的東西"}
                className={`${inputCls} !py-1`}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Exact width × height; typed values snap to a multiple of 32 when the field is left. */
function CustomSize({ size, onChange }: { size: { width: number; height: number }; onChange: (s: { width: number; height: number }) => void }) {
  const field = (key: "width" | "height") => (
    <input
      key={`${key}-${size[key]}`}
      type="number"
      min={CUSTOM_SIZE.min}
      max={CUSTOM_SIZE.max}
      step={CUSTOM_SIZE.step}
      defaultValue={size[key]}
      onBlur={(e) => {
        const v = snapSize(Number(e.target.value) || size[key]);
        e.target.value = String(v);
        if (v !== size[key]) onChange({ ...size, [key]: v });
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      title={`${CUSTOM_SIZE.min}–${CUSTOM_SIZE.max}，32 的倍數`}
      className={`${inputCls} !w-20 !px-2 !py-1 text-xs tabular-nums`}
    />
  );
  return (
    <div className="flex items-center gap-1 text-xs text-muted">
      {field("width")}
      <button
        className="px-1 hover:text-fg"
        title="寬高對調"
        onClick={() => onChange({ width: size.height, height: size.width })}
      >
        ×
      </button>
      {field("height")}
      <span className="ml-1 text-faint">{((size.width * size.height) / 1024 / 1024).toFixed(1)} MP</span>
    </div>
  );
}

/** The images an edit works on, each labelled with the tag instructions use for it. */
function EditTargets({
  state,
  onInsert,
  onRemoveRef,
  onAddRefs,
  onUploadClick,
  onExit,
}: {
  state: ComposerState;
  onInsert: (n: number) => void;
  onRemoveRef: (id: string) => void;
  onAddRefs: (imgs: ImageRecord[]) => void;
  onUploadClick: () => void;
  onExit: () => void;
}) {
  const { recent } = useStudio();
  const [picking, setPicking] = useState(false);
  const edit = state.edit!;
  const used = new Set([edit.source.id, ...edit.refs.map((r) => r.id)]);

  return (
    <div className="relative mb-3 flex items-center gap-2 border-b border-line pb-3">
      <span className="mr-1 text-xs font-medium text-accent">修改模式</span>
      <Thumb img={edit.source} n={1} label="原圖" onClick={() => onInsert(1)} />
      {edit.refs.map((r, i) => (
        <Thumb key={r.id} img={r} n={i + 2} label="參考" onClick={() => onInsert(i + 2)} onRemove={() => onRemoveRef(r.id)} />
      ))}
      {edit.refs.length < MAX_REFS && (
        <button
          onClick={() => setPicking((v) => !v)}
          className={`flex h-14 items-center gap-1 rounded-lg border border-dashed px-3 text-xs transition ${
            picking ? "border-accent text-accent" : "border-line text-muted hover:border-muted hover:text-fg"
          }`}
        >
          <Plus className="size-3.5" /> 參考圖
        </button>
      )}
      <span className="ml-2 hidden text-xs text-faint xl:inline">點縮圖可把代號插進指令</span>
      <button onClick={onExit} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-raised hover:text-fg">
        <X className="size-3.5" /> 改回生成新圖
      </button>

      {picking && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-[min(520px,calc(100vw-2rem))] rounded-xl border border-line bg-raised p-3 shadow-2xl shadow-black/60">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-muted">選參考圖（可多選）</span>
            <div className="flex gap-1">
              <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={onUploadClick}>
                <Upload className="size-3.5" /> 上傳
              </Button>
              <IconButton label="關閉" onClick={() => setPicking(false)}>
                <X className="size-4" />
              </IconButton>
            </div>
          </div>
          <div className="grid max-h-64 grid-cols-4 gap-1.5 sm:grid-cols-6 overflow-y-auto">
            {recent
              .filter((r) => !used.has(r.id))
              .map((r) => (
                <button
                  key={r.id}
                  onClick={() => onAddRefs([r])}
                  className="aspect-square overflow-hidden rounded-md border border-line hover:border-accent"
                  title={r.params.prompt}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(r.id, 160)} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Thumb({
  img,
  n,
  label,
  onClick,
  onRemove,
}: {
  img: ImageRecord;
  n: number;
  label: string;
  onClick: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        title={`插入 <image${n}>`}
        className={`relative block h-14 overflow-hidden rounded-lg border ${n === 1 ? "border-accent" : "border-line"} hover:border-fg`}
        style={{ aspectRatio: img.width / img.height }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl(img.id, 160)} alt="" className="h-full w-full object-cover" />
        <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 text-center font-mono text-[10px] leading-4 text-fg">
          {label} {n}
        </span>
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          title="移除"
          className="absolute -top-1.5 -right-1.5 hidden size-4 place-items-center rounded-full bg-bad text-white group-hover:grid pointer-coarse:grid"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

/** Image to video: an optional first frame (and an end frame to move towards). Empty = text to video. */
function VideoFrames({
  state,
  setState,
  onUploadClick,
}: {
  state: ComposerState;
  setState: (fn: (s: ComposerState) => ComposerState) => void;
  onUploadClick: () => void;
}) {
  const { recent } = useStudio();
  const [picking, setPicking] = useState<"first" | "last" | null>(null);
  const v = state.video;
  const setFrame = (which: "first" | "last", img?: ImageRecord) =>
    setState((s) => ({
      ...s,
      video: which === "first" ? { ...s.video, first: img, last: img ? s.video.last : undefined } : { ...s.video, last: img },
    }));

  const slot = (which: "first" | "last", img?: ImageRecord) => (
    <div className="group relative">
      {img ? (
        <>
          <button
            onClick={() => setPicking(picking === which ? null : which)}
            className="relative block h-14 overflow-hidden rounded-lg border border-accent"
            style={{ aspectRatio: img.width / img.height }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(img.id, 160)} alt="" className="h-full w-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 text-center text-[10px] leading-4">
              {which === "first" ? "第一幀" : "結尾幀"}
            </span>
          </button>
          <button
            onClick={() => setFrame(which)}
            title="移除"
            className="absolute -top-1.5 -right-1.5 hidden size-4 place-items-center rounded-full bg-bad text-white group-hover:grid pointer-coarse:grid"
          >
            <X className="size-3" />
          </button>
        </>
      ) : (
        <button
          onClick={() => setPicking(picking === which ? null : which)}
          className={`flex h-14 items-center gap-1 rounded-lg border border-dashed px-3 text-xs transition ${
            picking === which ? "border-accent text-accent" : "border-line text-muted hover:border-muted hover:text-fg"
          }`}
        >
          <Plus className="size-3.5" /> {which === "first" ? "第一幀（選填）" : "結尾幀（選填）"}
        </button>
      )}
    </div>
  );

  return (
    <div className="relative mb-3 flex items-center gap-2 border-b border-line pb-3">
      <span className="mr-1 text-xs font-medium text-accent">{v.first ? "圖片生成影片" : "文字生成影片"}</span>
      {slot("first", v.first)}
      {v.first && slot("last", v.last)}
      <span className="ml-2 hidden text-xs text-faint xl:inline">
        {v.first ? "影片從第一幀開始，比例跟著它" : "沒有第一幀時，照下方選的比例從文字生成"}
      </span>

      {picking && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-[min(520px,calc(100vw-2rem))] rounded-xl border border-line bg-raised p-3 shadow-2xl shadow-black/60">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-muted">選{picking === "first" ? "第一幀" : "結尾幀"}</span>
            <div className="flex gap-1">
              <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={onUploadClick}>
                <Upload className="size-3.5" /> 上傳
              </Button>
              <IconButton label="關閉" onClick={() => setPicking(null)}>
                <X className="size-4" />
              </IconButton>
            </div>
          </div>
          <div className="grid max-h-64 grid-cols-4 gap-1.5 sm:grid-cols-6 overflow-y-auto">
            {recent
              .filter((r) => r.media === "image")
              .map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setFrame(picking, r);
                    setPicking(null);
                  }}
                  className="aspect-square overflow-hidden rounded-md border border-line hover:border-accent"
                  title={r.params.prompt}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(r.id, 160)} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
