"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Download, Film, Image as ImageIcon, Loader2, Plus, RotateCcw, SkipForward, Square, Type, Wand2, X } from "lucide-react";
import { api, imageUrl, streamLlm } from "@/lib/client/api";
import { ASPECTS, randomSeed, type AspectId } from "@/lib/shared/sizes";
import type { GenerateParams, ImageRecord, PromptOrigin, VideoSpeed } from "@/lib/shared/types";
import { DEFAULT_VIDEO_SPEED, framesFor, speedOf, VIDEO_SPEED_REV, VIDEO_SPEEDS, videoEstimate, videoSize } from "@/lib/tools/video";
import { SamplerRows, VideoQualityChips, VideoStepRows } from "@/components/studio/sampler-fields";
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

// A step-by-step page for MiniMax H3 video: pick a start (text or a first
// frame), write the idea, let the local LLM turn it into a video prompt, set
// length and quality, then generate. Finished clips play on the right and can
// be continued from their last frame.
//
// Images can guide both steps: first and end frames go into the clip itself,
// reference images only show the LLM what to describe.
// `?first=<image id>` starts from that image (e.g. from the image page).
// Between the first and end frames, keyframes pin more images at chosen times.

const MAX_REFS = 6;
const MAX_KEYFRAMES = 4;

/** A keyframe being set up: its time, and its image once one is picked. */
interface KeySlot {
  key: number;
  at: number;
  img?: ImageRecord;
}

interface Form {
  source: "text" | "image";
  aspect: AspectId;
  idea: string;
  prompt: string;
  presetId: string;
  seconds: number;
  megapixels: number;
  seed: number;
  seedLocked: boolean;
  count: number;
  speed: VideoSpeed;
  steps: number;
  sampler: string;
  scheduler: string;
}

const SAMPLER_DEFAULTS = { sampler: "res_multistep", scheduler: "simple" };

const DEFAULTS: Form = {
  source: "text",
  aspect: "16:9",
  idea: "",
  prompt: "",
  presetId: "h3-video",
  seconds: 3,
  megapixels: 0.4,
  seed: randomSeed(),
  seedLocked: false,
  count: 1,
  speed: DEFAULT_VIDEO_SPEED,
  steps: VIDEO_SPEEDS[DEFAULT_VIDEO_SPEED].steps,
  ...SAMPLER_DEFAULTS,
};

const STORE = "studio.video";

export default function VideoPage() {
  const { recent, presets, status } = useStudio();
  const [form, setForm] = useState<Form>(DEFAULTS);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const [first, setFirst] = useState<ImageRecord>();
  const [last, setLast] = useState<ImageRecord>();
  const [origin, setOrigin] = useState<PromptOrigin>();
  const [expanding, setExpanding] = useState(false);
  const [reasoning, setReasoning] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [shown, setShown] = useState<string>();
  const [refs, setRefs] = useState<ImageRecord[]>([]);
  const [keySlots, setKeySlots] = useState<KeySlot[]>([]);
  /** Set when the first frame is a clip's last frame: that clip, whose story this one continues. */
  const [previous, setPrevious] = useState<ImageRecord>();
  const [continuity, setContinuity] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const { myJobs, running, done, track } = usePageJobs(setShown);

  // Pick up where this browser left off (text and settings only, not the frames),
  // then take a first frame handed over in the link.
  useEffect(() => {
    // Browser storage only exists after hydration, so restoring it has to happen in an effect.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Partial<Form> & { speedRev?: number };
      // Saved before speeds existed (steps for 8-step Turbo) or before pi-H3 became the default.
      const keepSpeed = !!saved.speed && saved.speedRev === VIDEO_SPEED_REV;
      setForm((f) => ({
        ...f,
        ...saved,
        seed: saved.seedLocked ? (saved.seed ?? f.seed) : f.seed,
        speed: keepSpeed ? saved.speed! : f.speed,
        steps: keepSpeed ? (saved.steps ?? f.steps) : f.steps,
      }));
    } catch {}
    /* eslint-enable react-hooks/set-state-in-effect */
    const firstId = new URLSearchParams(window.location.search).get("first");
    if (firstId) {
      window.history.replaceState(null, "", "/video");
      api.image(firstId).then(
        (img) => {
          setForm((f) => ({ ...f, source: "image", idea: "", prompt: "" }));
          setFirst(img);
          setLast(undefined);
        },
        () => setError("找不到要當第一幀的圖片"),
      );
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ ...form, speedRev: VIDEO_SPEED_REV }));
    } catch {}
  }, [form]);

  // Fall back to any video preset if the saved one is gone.
  const videoPresets = presets.filter((p) => p.purpose === "video");
  const preset = videoPresets.find((p) => p.id === form.presetId) ?? videoPresets[0];

  const imageMode = form.source === "image";

  // Is the first frame the end of an earlier clip? Then that clip's prompt carries the story on.
  const firstId = imageMode ? first?.id : undefined;
  const parentId = first?.params.prompt === "影片最後一幀" ? first.parentId : undefined;
  useEffect(() => {
    let live = true;
    if (!firstId || !parentId) Promise.resolve(undefined).then(() => live && setPrevious(undefined));
    else
      api.image(parentId).then(
        (v) => live && setPrevious(v.media === "video" ? v : undefined),
        () => live && setPrevious(undefined),
      );
    return () => {
      live = false;
    };
  }, [firstId, parentId]);
  const continuing = !!previous && continuity;
  const [aw, ah] = imageMode && first ? [first.width, first.height] : aspectRatio(form.aspect);
  const { width, height } = videoSize(form.megapixels, aw, ah);
  const frames = framesFor(form.seconds);
  const estimate = videoEstimate(form.seconds, form.megapixels, form.steps);
  // Keyframes that count: picked, inside the clip, in time order.
  const keyframes = imageMode && first
    ? keySlots
        .filter((k): k is KeySlot & { img: ImageRecord } => !!k.img && k.at > 0 && k.at < form.seconds)
        .sort((a, b) => a.at - b.at)
    : [];
  const setKey = (key: number, patch: Partial<KeySlot>) => setKeySlots((ks) => ks.map((k) => (k.key === key ? { ...k, ...patch } : k)));
  function addKeySlot() {
    setKeySlots((ks) => {
      // Spread new ones out: halfway between the latest keyframe and the end.
      const latest = Math.max(0, ...ks.map((k) => k.at));
      const at = Math.round(((latest + form.seconds) / 2) * 10) / 10;
      return [...ks, { key: Date.now(), at }];
    });
  }

  const videos = useMemo(() => recent.filter((r) => r.media === "video"), [recent]);
  const current = videos.find((v) => v.id === shown) ?? videos[0];

  const steps = [
    { label: "起點", done: !imageMode || !!first },
    { label: "想法", done: !!form.idea.trim() || !!form.prompt.trim() },
    { label: "Prompt", done: !!form.prompt.trim() },
    { label: "設定", done: !!form.prompt.trim() },
    { label: "生成", done: done > 0 },
  ];
  const busy = expanding;
  const canRun = !!form.prompt.trim() && (!imageMode || !!first) && !busy;

  async function expand() {
    const idea = form.idea.trim();
    if ((!idea && !continuing && !(imageMode && first) && !refs.length) || !preset || (imageMode && !first)) return;
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
          imageIds: imageMode ? [first?.id, ...keyframes.map((k) => k.img.id), last?.id].filter((x): x is string => !!x) : [],
          refImageIds: refs.map((r) => r.id),
          continuity,
          video: {
            seconds: form.seconds,
            ...(imageMode ? {} : { width, height }),
            ...(keyframes.length ? { keyframes: keyframes.map((k) => k.at) } : {}),
          },
        },
        {
          onContent: (t) => set({ prompt: (out += t).trimStart() }),
          onReasoning: (t) => setReasoning((r) => r + t),
        },
        ac.signal,
      );
      set({ prompt: out.trim() });
      setOrigin({ idea: idea || (continuing ? "（接續上一段）" : "（依圖片擴寫）"), presetId: preset.id, presetName: preset.name, systemPrompt: preset.content, llmModel: status?.llmModel });
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      out = "";
    } finally {
      setExpanding(false);
      abortRef.current = null;
    }
  }

  const addRefs = (imgs: ImageRecord[]) =>
    setRefs((rs) => [...rs, ...imgs.filter((i) => !rs.some((r) => r.id === i.id))].slice(0, MAX_REFS));

  /**
   * Dropped or pasted images, in the order given: in image mode the first one
   * fills the first frame and, when several come at once, the last one the end
   * frame, with the ones between as storyboard photos; otherwise they all
   * become storyboard / reference photos for the prompt.
   */
  const { dragging, dropProps } = useImageDrop(async (files) => {
    setError(undefined);
    try {
      const saved = await api.upload(files);
      if (imageMode) {
        const queue = [...saved];
        if (!first) setFirst(queue.shift());
        if (queue.length && !last) setLast(queue.pop());
        if (queue.length) addRefs(queue);
      } else addRefs(saved);
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
      negativePrompt: "",
      width,
      height,
      steps: form.steps,
      cfg: 1,
      seed,
      sampler: form.sampler,
      scheduler: form.scheduler,
      video: {
        seconds: form.seconds,
        megapixels: form.megapixels,
        firstFrameId: imageMode ? first?.id : undefined,
        lastFrameId: imageMode && first ? last?.id : undefined,
        ...(keyframes.length ? { keyframes: keyframes.map((k) => ({ imageId: k.img.id, at: k.at })) } : {}),
        speed: form.speed,
      },
    };
    try {
      track(await api.generate({ params, count: form.count, origin: origin?.idea ? origin : undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  /** The next clip starts where this one ends. */
  async function continueFrom(video: ImageRecord) {
    setError(undefined);
    try {
      const frame = await api.frame(video.id, "last");
      set({ source: "image", idea: "", prompt: "" });
      setFirst(frame);
      setLast(undefined);
      setKeySlots([]);
      setOrigin(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Load a finished clip's settings back into the form. */
  function reuse(video: ImageRecord) {
    const p = video.params;
    set({
      prompt: p.prompt,
      idea: video.origin?.idea ?? "",
      seconds: p.video?.seconds ?? form.seconds,
      megapixels: p.video?.megapixels ?? form.megapixels,
      speed: speedOf(p.video),
      steps: p.steps || VIDEO_SPEEDS[speedOf(p.video)].steps,
      sampler: p.sampler ?? SAMPLER_DEFAULTS.sampler,
      scheduler: p.scheduler ?? SAMPLER_DEFAULTS.scheduler,
      seed: p.seed,
      seedLocked: true,
      source: p.video?.firstFrameId ? "image" : "text",
    });
    setOrigin(video.origin);
    setRefs([]);
    if (p.video?.firstFrameId) api.image(p.video.firstFrameId).then(setFirst, () => setFirst(undefined));
    else setFirst(undefined);
    if (p.video?.lastFrameId) api.image(p.video.lastFrameId).then(setLast, () => setLast(undefined));
    else setLast(undefined);
    const keys = p.video?.keyframes ?? [];
    Promise.all(keys.map((k) => api.image(k.imageId).catch(() => undefined))).then((imgs) =>
      setKeySlots(keys.map((k, i) => ({ key: i, at: k.at, img: imgs[i] }))),
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-y-auto md:flex-row md:overflow-hidden" {...dropProps}>
      {dragging && (
        <DropOverlay
          text={
            imageMode
              ? !first
                ? "放開：設為第一幀"
                : !last
                  ? "放開：設為結尾幀"
                  : "放開：加入參考圖"
              : "放開：加入參考圖，讓 LLM 看圖寫 prompt"
          }
        />
      )}
      {/* Workflow */}
      <div className="flex w-full shrink-0 flex-col border-b border-line bg-panel md:w-[480px] md:border-r md:border-b-0">
        <WorkflowHeader icon={Clapperboard} title="影片生成" subtitle="MiniMax H3 · 畫面和聲音一起生成" steps={steps} />

        <div className="flex-1 space-y-3 p-3 md:overflow-y-auto md:p-4">
          <Step n={1} title="起點" hint="從文字生成，或讓一張圖動起來">
            <SourceTabs
              value={form.source}
              options={[
                ["text", "文字生成影片", Type],
                ["image", "圖片生成影片", ImageIcon],
              ]}
              onChange={(source) => set({ source })}
            />
            {imageMode ? (
              <>
                <div className="mt-3 flex items-start gap-3">
                  <ImageSlot label="第一幀" required img={first} onPick={setFirst} onClear={() => (setFirst(undefined), setLast(undefined))} />
                  {first && <ImageSlot label="結尾幀（選填）" img={last} onPick={setLast} onClear={() => setLast(undefined)} />}
                </div>
                {first && (
                  <div className="mt-3">
                    <div className="mb-1.5 flex items-center gap-2 text-xs">
                      <span className="text-muted">中間關鍵幀</span>
                      <span className="text-faint">影片會在指定的秒數經過這些畫面</span>
                    </div>
                    <div className="flex flex-wrap items-start gap-3">
                      {keySlots.map((k) => {
                        const outside = k.at <= 0 || k.at >= form.seconds;
                        return (
                          <div key={k.key} className="flex flex-col items-center gap-1">
                            <ImageSlot
                              label={`${k.at} 秒`}
                              img={k.img}
                              onPick={(img) => setKey(k.key, { img })}
                              onClear={() => setKey(k.key, { img: undefined })}
                            />
                            <div className="flex items-center gap-1 text-[11px]">
                              <input
                                type="number"
                                min={0.1}
                                max={form.seconds - 0.1}
                                step={0.1}
                                value={k.at}
                                onChange={(e) => setKey(k.key, { at: Number(e.target.value) })}
                                className={`${inputCls} !w-16 !px-1.5 !py-0.5 text-center font-mono text-[11px] ${outside ? "!border-bad" : ""}`}
                                title={outside ? `要在 0 到 ${form.seconds} 秒之間` : "在第幾秒出現"}
                              />
                              秒
                              <button
                                onClick={() => setKeySlots((ks) => ks.filter((x) => x.key !== k.key))}
                                title="移除這個關鍵幀"
                                className="text-faint hover:text-bad"
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {keySlots.length < MAX_KEYFRAMES && (
                        <button
                          onClick={addKeySlot}
                          className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-xs text-muted transition hover:border-muted hover:text-fg"
                        >
                          <Plus className="size-4" /> 關鍵幀
                        </button>
                      )}
                    </div>
                    {keyframes.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-faint">
                        順序：第一幀 → {keyframes.map((k) => `${k.at} 秒`).join(" → ")}
                        {last ? " → 結尾幀" : ""}。擴寫時 LLM 會看到每一張，照順序寫出動作。
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-0.5">
                <span className="mr-2 text-xs text-muted">比例</span>
                {ASPECTS.map((a) => (
                  <Chip key={a.id} on={form.aspect === a.id} onClick={() => set({ aspect: a.id })}>
                    {a.id}
                  </Chip>
                ))}
              </div>
            )}
          </Step>

          <Step n={2} title="想法" hint="任何語言，一兩句就好；可附參考圖">
            {previous && (
              <div className={`mb-2.5 rounded-lg border px-3 py-2 text-xs ${continuity ? "border-accent/40 bg-accent-strong/10" : "border-line"}`}>
                <div className="flex items-center gap-2">
                  <SkipForward className="size-3.5 text-accent" />
                  <span className="font-medium">接續上一段</span>
                  <button className="text-faint hover:text-fg" onClick={() => setShown(previous.id)} title="在右邊播放上一段">
                    播放
                  </button>
                  <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-muted">
                    <input
                      type="checkbox"
                      checked={continuity}
                      onChange={(e) => setContinuity(e.target.checked)}
                      className="accent-accent-strong"
                    />
                    帶入前段劇情
                  </label>
                </div>
                <p className={`mt-1.5 line-clamp-3 whitespace-pre-line ${continuity ? "text-muted" : "text-faint line-through"}`}>
                  {previous.params.prompt}
                </p>
                <p className="mt-1 text-[11px] text-faint">
                  {continuity
                    ? "擴寫時會附上前面各段的 prompt（最多 3 段），讓人物、場景、聲音延續，動作從上一段結束處往下走。"
                    : "不帶前段劇情：只看第一幀寫 prompt。"}
                </p>
              </div>
            )}
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
                continuing
                  ? "下一段發生什麼？例如「他收勢後轉身走向長椅坐下」。留空就讓 LLM 自然接續劇情。"
                  : imageMode
                  ? "從第一幀開始，接下來發生什麼？例如「她轉頭微笑，說：早安」"
                  : "誰在哪裡做什麼？例如「老爺爺在公園打太極，旁邊有鴿子」"
              }
              className={`${inputCls} resize-none`}
            />
            <RefImages
              refs={refs}
              max={MAX_REFS}
              onAdd={addRefs}
              onRemove={(id) => setRefs((rs) => rs.filter((r) => r.id !== id))}
              label={refs.length > 1 ? "分鏡照片" : "參考圖"}
              tag={refs.length > 1 ? (i) => String(i + 1) : undefined}
              hint={
                refs.length > 1
                  ? imageMode
                    ? `擴寫時 LLM 照順序看：第一幀 → 1 → … → ${refs.length}${last ? " → 結尾幀" : ""}，寫成一段連續的劇情。照片只給 LLM 看，不會放進影片。`
                    : `擴寫時 LLM 照 1 → ${refs.length} 的順序把照片寫成一段連續的劇情；影片仍由文字生成。`
                  : imageMode
                    ? "只給 LLM 看（例如角色長相、服裝），不會放進影片。放兩張以上就照順序當分鏡。"
                    : "LLM 會看圖，把人物、服裝、場景或風格寫進 prompt；影片仍由文字生成。放兩張以上就照順序當分鏡。可拖放或 Ctrl+V 貼上。"
              }
            />
            {imageMode && first && (
              <p className="mt-1.5 text-[11px] text-faint">
                擴寫會自動帶入第一幀{keyframes.length ? `、${keyframes.length} 張中間關鍵幀` : ""}{last ? "、結尾幀" : ""}{refs.length ? `和上方 ${refs.length} 張${refs.length > 1 ? "分鏡照片" : "參考圖"}` : ""}。
              </p>
            )}
          </Step>

          <Step n={3} title="Prompt" hint="用地端 LLM 寫成英文影片 prompt，可再手動修改">
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
                  disabled={(!form.idea.trim() && !continuing && !(imageMode && first) && !refs.length) || !preset || (imageMode && !first)}
                  title={imageMode && !first ? "先選第一幀" : "Ctrl+Enter"}
                >
                  <Wand2 className="size-3.5" /> 擴寫
                </Button>
              )}
              <PresetSelect
                presets={presets}
                purpose="video"
                value={preset?.id ?? ""}
                onChange={(id) => set({ presetId: id })}
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
              placeholder={"按「擴寫」產生，或直接用英文寫：\n一段畫面描述（動作、鏡頭、光線），\n最後一行「Audio: …」描述聲音。"}
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
              <label>長度</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={0.5}
                  value={form.seconds}
                  onChange={(e) => set({ seconds: Number(e.target.value) })}
                  className="flex-1 accent-accent-strong"
                />
                <span className="w-24 text-right text-fg tabular-nums">
                  {(frames / 24).toFixed(1)} 秒 · {frames} 幀
                </span>
              </div>
              <label>畫質</label>
              <div className="flex items-center gap-1">
                <VideoQualityChips megapixels={form.megapixels} aspect={[aw, ah]} onChange={(megapixels) => set({ megapixels })} />
                <span className="ml-2 text-faint tabular-nums">
                  {width}×{height}
                  {form.megapixels === 0.98 ? "（官方）" : ""}
                </span>
              </div>
              <VideoStepRows speed={form.speed} steps={form.steps} onChange={set} />
              {!VIDEO_SPEEDS[form.speed].adapter && (
                <SamplerRows
                  sampler={form.sampler}
                  scheduler={form.scheduler}
                  defaults={SAMPLER_DEFAULTS}
                  hint="官方：res_multistep + simple"
                  onChange={set}
                />
              )}
              <SeedCountRows seed={form.seed} seedLocked={form.seedLocked} count={form.count} unit="支" onChange={set} />
            </div>
          </Step>

          <Step n={5} title="生成">
            <div className="flex items-center gap-3">
              <Button variant="primary" className="flex-1 !py-2" onClick={generate} disabled={!canRun || submitting}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Film className="size-4" />}
                生成影片
              </Button>
              <span className="text-right text-xs leading-tight text-faint tabular-nums">
                {imageMode && !first ? "跟著第一幀" : `${width}×${height}`}
                <br />每支約 {estimate} 秒
              </span>
            </div>
            {!canRun && !busy && (
              <p className="mt-2 text-xs text-faint">{imageMode && !first ? "先在步驟 1 選第一幀。" : "先完成步驟 3 的 prompt。"}</p>
            )}
            <JobList jobs={myJobs} showLabel="播放" onShow={setShown} />
          </Step>

          {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}
        </div>
      </div>

      {/* Player and history */}
      <div className="flex min-w-0 shrink-0 flex-col md:flex-1 md:shrink">
        <div className="flex min-h-0 flex-1 items-center justify-center p-3 md:p-6">
          {current ? (
            <div className="flex max-h-full w-full flex-col items-center gap-3">
              <video
                key={current.id}
                src={imageUrl(current.id)}
                poster={imageUrl(current.id, 640)}
                controls
                autoPlay
                loop
                playsInline
                className="max-h-[60vh] md:max-h-[calc(100vh-280px)] max-w-full rounded-lg bg-black shadow-2xl shadow-black/50"
              />
              <div className="flex flex-wrap items-center justify-center gap-1">
                <Button variant="primary" className="!py-1 text-xs" onClick={() => continueFrom(current)}>
                  <SkipForward className="size-3.5" /> 用最後一幀接續
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
              <Clapperboard className="size-10" strokeWidth={1} />
              <p>照步驟走，完成的影片會在這裡播放</p>
            </div>
          )}
        </div>

        <RecentStrip
          title="最近的影片"
          items={videos}
          currentId={current?.id}
          running={running}
          runningUnit="支"
          empty="還沒有影片"
          onSelect={setShown}
        />
      </div>
    </div>
  );
}

function aspectRatio(id: AspectId): [number, number] {
  const a = ASPECTS.find((x) => x.id === id) ?? ASPECTS[0];
  return [a.w, a.h];
}
