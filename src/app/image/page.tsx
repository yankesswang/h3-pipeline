"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Download, ImagePlus, Loader2, Pencil, RotateCcw, Sparkles, Square, Type, Wand2 } from "lucide-react";
import { api, imageUrl, streamLlm } from "@/lib/client/api";
import { ASPECTS, MEGAPIXELS, QUALITIES, randomSeed, sizeFor, snapSize, type AspectId } from "@/lib/shared/sizes";
import type { GenerateParams, ImageRecord, LoraUse, PromptOrigin } from "@/lib/shared/types";
import { MAX_REFS as MAX_EDIT_REFS } from "@/components/studio/composer-state";
import { LoraPicker } from "@/components/studio/lora-picker";
import { SamplerRows } from "@/components/studio/sampler-fields";
import { useStudio } from "@/components/studio-provider";
import { Button, Chip, PresetSelect, inputCls } from "@/components/ui";
import {
  DropOverlay,
  ImageSlot,
  JobList,
  RecentStrip,
  RefImages,
  SeedCountRows,
  SourceTabs,
  Step,
  WorkflowHeader,
  useImageDrop,
  usePageJobs,
} from "@/components/workflow";

// A step-by-step page for Qwen Image, laid out like the video page: pick a
// start (a new image from text, or changing an existing one), write the idea,
// let the local LLM turn it into an English prompt, set size and quality, then generate. Results show on the right and
// can be edited further or turned into a video.
//
// Images play two roles: when editing, the source and its references go into
// the model as <image1>, <image2>...; for a new image, reference images only
// show the LLM what to describe.

const MAX_LLM_REFS = 4;
const SAMPLER_DEFAULTS = { sampler: "euler", scheduler: "simple" };

interface Form {
  source: "text" | "edit";
  aspect: AspectId;
  megapixels: number;
  /** Set: exact width × height instead of aspect and megapixels. */
  customSize: { width: number; height: number } | null;
  idea: string;
  prompt: string;
  generatePresetId: string;
  editPresetId: string;
  steps: number;
  cfg: number;
  negativePrompt: string;
  sampler: string;
  scheduler: string;
  /** Editing only: below 1 keeps more of the source's structure. */
  denoise: number;
  loras: LoraUse[];
  seed: number;
  seedLocked: boolean;
  count: number;
}

const DEFAULTS: Form = {
  source: "text",
  aspect: "1:1",
  megapixels: 1,
  customSize: null,
  idea: "",
  prompt: "",
  generatePresetId: "qwen-general",
  editPresetId: "qwen-edit",
  steps: 40,
  cfg: 1,
  negativePrompt: "",
  ...SAMPLER_DEFAULTS,
  denoise: 1,
  loras: [],
  seed: randomSeed(),
  seedLocked: false,
  count: 1,
};

const STORE = "studio.image";

export default function ImagePage() {
  const router = useRouter();
  const { recent, presets, status } = useStudio();
  const [form, setForm] = useState<Form>(DEFAULTS);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  /** Editing: the image being changed (<image1>) and its references (<image2>...). */
  const [source, setSource] = useState<ImageRecord>();
  const [editRefs, setEditRefs] = useState<ImageRecord[]>([]);
  /** A new image: pictures the LLM looks at while writing the prompt. */
  const [llmRefs, setLlmRefs] = useState<ImageRecord[]>([]);
  const [origin, setOrigin] = useState<PromptOrigin>();
  const [expanding, setExpanding] = useState(false);
  const [reasoning, setReasoning] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [shown, setShown] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const { myJobs, running, done, track } = usePageJobs(setShown);

  // Pick up where this browser left off (text and settings only, not the images).
  useEffect(() => {
    // Browser storage only exists after hydration, so restoring it has to happen in an effect.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Partial<Form>;
      setForm((f) => ({ ...f, ...saved, source: "text", seed: saved.seedLocked ? (saved.seed ?? f.seed) : f.seed }));
    } catch {}
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(form));
    } catch {}
  }, [form]);

  const editing = form.source === "edit";
  const purpose = editing ? "edit" : "generate";
  const purposePresets = presets.filter((p) => p.purpose === purpose);
  const presetId = editing ? form.editPresetId : form.generatePresetId;
  const preset = purposePresets.find((p) => p.id === presetId) ?? purposePresets[0];

  const { width, height } = editing
    ? { width: source?.width ?? 0, height: source?.height ?? 0 }
    : (form.customSize ?? sizeFor(form.aspect, form.megapixels));
  const quality = QUALITIES.find((q) => q.steps === form.steps);

  const images = useMemo(() => recent.filter((r) => r.media === "image"), [recent]);
  const current = images.find((v) => v.id === shown) ?? images[0];

  const steps = [
    { label: "起點", done: !editing || !!source },
    { label: "想法", done: !!form.idea.trim() || !!form.prompt.trim() },
    { label: "Prompt", done: !!form.prompt.trim() },
    { label: "設定", done: !!form.prompt.trim() },
    { label: "生成", done: done > 0 },
  ];
  const busy = expanding;
  const canRun = !!form.prompt.trim() && (!editing || !!source) && !busy;

  async function expand() {
    const idea = form.idea.trim();
    if (!idea || !preset) return;
    setError(undefined);
    setReasoning("");
    setExpanding(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let out = "";
    set({ prompt: "" });
    try {
      await streamLlm(
        "/api/llm/expand",
        {
          presetId: preset.id,
          idea,
          imageIds: editing && source ? [source.id, ...editRefs.map((r) => r.id)] : [],
          refImageIds: editing ? [] : llmRefs.map((r) => r.id),
        },
        {
          onContent: (t) => set({ prompt: (out += t).trimStart() }),
          onReasoning: (t) => setReasoning((r) => r + t),
        },
        ac.signal,
      );
      set({ prompt: out.trim() });
      setOrigin({ idea, presetId: preset.id, presetName: preset.name, systemPrompt: preset.content, llmModel: status?.llmModel });
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      out = "";
    } finally {
      setExpanding(false);
      abortRef.current = null;
    }
  }

  const addTo = (setList: typeof setLlmRefs, max: number, skip?: string) => (imgs: ImageRecord[]) =>
    setList((rs) => [...rs, ...imgs.filter((i) => i.id !== skip && !rs.some((r) => r.id === i.id))].slice(0, max));
  const addEditRefs = addTo(setEditRefs, MAX_EDIT_REFS, source?.id);
  const addLlmRefs = addTo(setLlmRefs, MAX_LLM_REFS);

  /** Start changing this image, keeping references that are still useful. */
  function editImage(img: ImageRecord) {
    set({ source: "edit", idea: "", prompt: "" });
    setOrigin(undefined);
    setSource(img);
    setEditRefs((rs) => rs.filter((r) => r.id !== img.id));
  }

  /**
   * Dropped or pasted images: when editing, the first fills the source and the
   * rest become references; for a new image they are references for the LLM.
   */
  const { dragging, dropProps } = useImageDrop(async (files) => {
    setError(undefined);
    try {
      const saved = await api.upload(files);
      if (editing) {
        const queue = [...saved];
        if (!source) setSource(queue.shift());
        if (queue.length) addEditRefs(queue);
      } else addLlmRefs(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  async function generate() {
    if (!canRun) return;
    setError(undefined);
    setSubmitting(true);
    const seed = form.seedLocked ? form.seed : randomSeed();
    if (!form.seedLocked) set({ seed });
    const params: GenerateParams = {
      prompt: form.prompt.trim(),
      negativePrompt: form.negativePrompt,
      width,
      height,
      steps: form.steps,
      cfg: form.cfg,
      seed,
      sampler: form.sampler,
      scheduler: form.scheduler,
      ...(editing && source ? { sourceImageId: source.id, refImageIds: editRefs.map((r) => r.id) } : {}),
      ...(editing && form.denoise < 1 ? { denoise: form.denoise } : {}),
      ...(form.loras.length ? { loras: form.loras } : {}),
    };
    try {
      track(await api.generate({ params, count: form.count, origin: origin?.idea ? origin : undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  /** Load a finished image's settings back into the form. */
  function reuse(img: ImageRecord) {
    const p = img.params;
    const aspect = nearestAspect(p.width / p.height);
    const megapixels = MEGAPIXELS.map((m) => m.id).reduce((b, m) =>
      Math.abs(m - (p.width * p.height) / 2 ** 20) < Math.abs(b - (p.width * p.height) / 2 ** 20) ? m : b,
    );
    const preset = sizeFor(aspect, megapixels);
    set({
      prompt: p.prompt,
      idea: img.origin?.idea ?? "",
      aspect,
      megapixels,
      customSize: preset.width === p.width && preset.height === p.height ? null : { width: p.width, height: p.height },
      steps: p.steps || DEFAULTS.steps,
      cfg: p.cfg || 1,
      negativePrompt: p.negativePrompt ?? "",
      sampler: p.sampler ?? SAMPLER_DEFAULTS.sampler,
      scheduler: p.scheduler ?? SAMPLER_DEFAULTS.scheduler,
      denoise: p.denoise ?? 1,
      loras: p.loras ?? [],
      seed: p.seed,
      seedLocked: true,
      source: p.sourceImageId ? "edit" : "text",
    });
    setOrigin(img.origin);
    setLlmRefs([]);
    if (p.sourceImageId) {
      api.image(p.sourceImageId).then(setSource, () => setSource(undefined));
      Promise.all((p.refImageIds ?? []).map((id) => api.image(id).catch(() => undefined))).then((rs) =>
        setEditRefs(rs.filter((r): r is ImageRecord => !!r)),
      );
    } else {
      setSource(undefined);
      setEditRefs([]);
    }
  }

  return (
    <div className="relative flex h-full flex-col overflow-y-auto md:flex-row md:overflow-hidden" {...dropProps}>
      {dragging && (
        <DropOverlay text={editing ? (!source ? "放開：設為要修改的圖" : "放開：加入參考圖（<image2> 起）") : "放開：加入參考圖，讓 LLM 看圖寫 prompt"} />
      )}
      {/* Workflow */}
      <div className="flex w-full shrink-0 flex-col border-b border-line bg-panel md:w-[480px] md:border-r md:border-b-0">
        <WorkflowHeader icon={Sparkles} title="圖片生成" subtitle="Qwen Image · 文字生圖，或修改一張圖" steps={steps} />

        <div className="flex-1 space-y-3 p-3 md:overflow-y-auto md:p-4">
          <Step n={1} title="起點" hint="從文字生成新圖，或修改一張圖">
            <SourceTabs
              value={form.source}
              options={[
                ["text", "文字生成圖片", Type],
                ["edit", "修改圖片", Pencil],
              ]}
              onChange={(s) => set({ source: s })}
            />
            {editing ? (
              <>
                <div className="mt-3 flex items-start gap-3">
                  <ImageSlot
                    label="要修改的圖 <image1>"
                    required
                    img={source}
                    onPick={(img) => (setSource(img), setEditRefs((rs) => rs.filter((r) => r.id !== img.id)))}
                    onClear={() => setSource(undefined)}
                  />
                </div>
                {source && (
                  <RefImages
                    refs={editRefs}
                    max={MAX_EDIT_REFS}
                    onAdd={addEditRefs}
                    onRemove={(id) => setEditRefs((rs) => rs.filter((r) => r.id !== id))}
                    tag={(i) => `<image${i + 2}>`}
                    hint="參考圖會一起送進模型，指令裡可以寫「換成 <image2> 的外套」。可拖放或 Ctrl+V 貼上。"
                  />
                )}
              </>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {form.customSize ? (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="mr-1">尺寸</span>
                    {(["width", "height"] as const).map((k, i) => (
                      <span key={k} className="flex items-center gap-2">
                        {i === 1 && "×"}
                        <input
                          type="number"
                          step={32}
                          value={form.customSize![k]}
                          onChange={(e) => set({ customSize: { ...form.customSize!, [k]: Number(e.target.value) } })}
                          onBlur={(e) => set({ customSize: { ...form.customSize!, [k]: snapSize(Number(e.target.value)) } })}
                          className={`${inputCls} !w-24 !py-1 font-mono text-xs`}
                        />
                      </span>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-0.5">
                      <span className="mr-2 text-xs text-muted">比例</span>
                      {ASPECTS.map((a) => (
                        <Chip key={a.id} on={form.aspect === a.id} onClick={() => set({ aspect: a.id })}>
                          {a.id}
                        </Chip>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-0.5">
                      <span className="mr-2 text-xs text-muted">大小</span>
                      {MEGAPIXELS.map((m) => (
                        <Chip key={m.id} on={form.megapixels === m.id} onClick={() => set({ megapixels: m.id })}>
                          {m.label}
                        </Chip>
                      ))}
                    </div>
                  </>
                )}
                <div className="flex items-center gap-2 text-xs">
                  <Chip on={!!form.customSize} onClick={() => set({ customSize: form.customSize ? null : { width, height } })}>
                    {form.customSize ? "改回比例" : "自訂尺寸"}
                  </Chip>
                  <span className="text-faint tabular-nums">
                    {width}×{height}
                  </span>
                </div>
              </div>
            )}
          </Step>

          <Step n={2} title="想法" hint={editing ? "要怎麼改？任何語言都可以" : "任何語言，一兩句就好；可附參考圖"}>
            <textarea
              value={form.idea}
              onChange={(e) => set({ idea: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  expand();
                }
              }}
              rows={3}
              placeholder={
                editing
                  ? "例如「把天空換成夕陽」「讓她穿上 <image2> 的外套」「移除背景的路人」"
                  : "想要什麼畫面？例如「賽博龐克風的台北夜市，下著雨」"
              }
              className={`${inputCls} resize-none`}
            />
            {!editing && (
              <RefImages
                refs={llmRefs}
                max={MAX_LLM_REFS}
                onAdd={addLlmRefs}
                onRemove={(id) => setLlmRefs((rs) => rs.filter((r) => r.id !== id))}
                hint="LLM 會看圖，把人物、服裝、場景、構圖或風格寫進 prompt；圖片本身不會送進生圖模型。可拖放或 Ctrl+V 貼上。"
              />
            )}
          </Step>

          <Step n={3} title="Prompt" hint={editing ? "用地端 LLM 看圖寫成精確的修圖指令" : "用地端 LLM 寫成完整的英文 prompt"}>
            <div className="mb-2 flex items-center gap-2">
              {busy ? (
                <Button
                  variant="outline"
                  className="!py-1 text-xs"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Square className="size-3.5" /> 停止
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="!py-1 text-xs text-accent"
                  onClick={expand}
                  disabled={!form.idea.trim() || !preset || (editing && !source)}
                  title={editing && !source ? "先選要修改的圖" : "Ctrl+Enter"}
                >
                  <Wand2 className="size-3.5" /> 擴寫
                </Button>
              )}
              <PresetSelect
                presets={presets}
                purpose={purpose}
                value={preset?.id ?? ""}
                onChange={(id) => set(editing ? { editPresetId: id } : { generatePresetId: id })}
                className="!py-1 text-xs"
              />
              <span className="ml-auto truncate text-[11px] text-faint" title="到「設定」或「監控」換模型">
                {status?.llmModel || "未選 LLM"}
              </span>
            </div>
            {expanding && !form.prompt && (
              <p className="mb-2 line-clamp-3 text-xs text-faint">
                <Loader2 className="mr-1 inline size-3 animate-spin" />
                {reasoning || "LLM 撰寫中…"}
              </p>
            )}
            <textarea
              value={form.prompt}
              onChange={(e) => set({ prompt: e.target.value })}
              rows={7}
              placeholder={
                editing
                  ? "按「擴寫」產生，或直接寫修圖指令（英文或中文都可以）。"
                  : "按「擴寫」產生，或直接寫 prompt：主體、場景、構圖、光線、風格。"
              }
              className={`${inputCls} resize-y font-mono text-xs leading-relaxed`}
            />
            {origin?.idea && (
              <p className="mt-1 text-[11px] text-faint">
                來自想法「{origin.idea}」· {origin.presetName} · {origin.llmModel}
              </p>
            )}
          </Step>

          <Step n={4} title="設定">
            <div className="grid grid-cols-[56px_1fr] items-center gap-x-3 gap-y-2.5 text-xs text-muted">
              <label>品質</label>
              <div className="flex items-center gap-1">
                {QUALITIES.map((q) => (
                  <Chip key={q.id} on={form.steps === q.steps} onClick={() => set({ steps: q.steps })}>
                    {q.label}
                  </Chip>
                ))}
                <span className="ml-2 text-faint">{form.steps} steps</span>
              </div>
              <label>Steps</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={4}
                  max={80}
                  value={form.steps}
                  onChange={(e) => set({ steps: Number(e.target.value) })}
                  className="flex-1 accent-accent-strong"
                />
                <span className="w-24 text-faint">{quality ? `（${quality.label}）` : "官方建議 40–50"}</span>
              </div>
              <label>CFG</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={0.5}
                  value={form.cfg}
                  onChange={(e) => set({ cfg: Number(e.target.value) })}
                  className="flex-1 accent-accent-strong"
                />
                <span className="w-24 text-fg tabular-nums">
                  {form.cfg} <span className="text-faint">{form.cfg <= 1 ? "（建議）" : "（慢一倍）"}</span>
                </span>
              </div>
              {form.cfg > 1 && (
                <>
                  <label>負面</label>
                  <input
                    value={form.negativePrompt}
                    onChange={(e) => set({ negativePrompt: e.target.value })}
                    placeholder="不想出現的東西"
                    className={`${inputCls} !py-1 text-xs`}
                  />
                </>
              )}
              {editing && (
                <>
                  <label>變化量</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0.3}
                      max={1}
                      step={0.05}
                      value={form.denoise}
                      onChange={(e) => set({ denoise: Number(e.target.value) })}
                      className="flex-1 accent-accent-strong"
                    />
                    <span className="w-24 text-fg tabular-nums">
                      {form.denoise.toFixed(2)} <span className="text-faint">{form.denoise < 1 ? "保留原圖結構" : ""}</span>
                    </span>
                  </div>
                </>
              )}
              <SamplerRows sampler={form.sampler} scheduler={form.scheduler} defaults={SAMPLER_DEFAULTS} hint="官方：euler + simple" onChange={set} />
              <label>LoRA</label>
              <LoraPicker value={form.loras} onChange={(loras) => set({ loras })} />
              <SeedCountRows seed={form.seed} seedLocked={form.seedLocked} count={form.count} unit="張" onChange={set} />
            </div>
          </Step>

          <Step n={5} title="生成">
            <div className="flex items-center gap-3">
              <Button variant="primary" className="flex-1 !py-2" onClick={generate} disabled={!canRun || submitting}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                {editing ? "修改圖片" : "生成圖片"}
              </Button>
              <span className="text-right text-xs leading-tight text-faint tabular-nums">
                {editing && !source ? "跟著原圖" : `${width}×${height}`}
                <br />
                {form.count} 張 · {form.steps} steps
              </span>
            </div>
            {!canRun && !busy && (
              <p className="mt-2 text-xs text-faint">{editing && !source ? "先在步驟 1 選要修改的圖。" : "先完成步驟 3 的 prompt。"}</p>
            )}
            <JobList jobs={myJobs} showLabel="查看" onShow={setShown} />
          </Step>

          {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}
        </div>
      </div>

      {/* Viewer and history */}
      <div className="flex min-w-0 shrink-0 flex-col md:flex-1 md:shrink">
        <div className="flex min-h-0 flex-1 items-center justify-center p-3 md:p-6">
          {current ? (
            <div className="flex max-h-full w-full flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={current.id}
                src={imageUrl(current.id)}
                alt={current.params.prompt}
                className="checker max-h-[60vh] md:max-h-[calc(100vh-280px)] max-w-full rounded-lg object-contain shadow-2xl shadow-black/50"
              />
              <div className="flex flex-wrap items-center justify-center gap-1">
                <Button variant="primary" className="!py-1 text-xs" onClick={() => editImage(current)}>
                  <Pencil className="size-3.5" /> 修改這張
                </Button>
                <Button variant="ghost" className="!py-1 text-xs" onClick={() => router.push(`/video?first=${current.id}`)}>
                  <Clapperboard className="size-3.5" /> 做成影片
                </Button>
                <Button variant="ghost" className="!py-1 text-xs" onClick={() => reuse(current)}>
                  <RotateCcw className="size-3.5" /> 重用設定
                </Button>
                <a
                  href={`${imageUrl(current.id)}?download=1`}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs text-muted hover:bg-raised hover:text-fg"
                >
                  <Download className="size-3.5" /> 下載
                </a>
              </div>
              <p className="line-clamp-3 max-w-2xl text-center text-xs whitespace-pre-line text-muted">{current.params.prompt}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-faint">
              <Sparkles className="size-10" strokeWidth={1} />
              <p>照步驟走，完成的圖片會在這裡顯示</p>
            </div>
          )}
        </div>

        <RecentStrip
          title="最近的圖片"
          items={images}
          currentId={current?.id}
          running={running}
          runningUnit="張"
          empty="還沒有圖片"
          onSelect={setShown}
        />
      </div>
    </div>
  );
}

function nearestAspect(ratio: number): AspectId {
  return ASPECTS.reduce((best, a) => (Math.abs(a.w / a.h - ratio) < Math.abs(best.w / best.h - ratio) ? a : best)).id;
}
