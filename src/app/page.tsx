"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageDown, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { clearMask, createMask, exportMask, invertMask, loadMask, maskIsEmpty } from "@/lib/client/mask";
import type { ChatMessage, ImageRecord, PresetPurpose, PromptOrigin } from "@/lib/shared/types";
import { VIDEO_SPEED_REV } from "@/lib/tools/video";
import { ImageInfo } from "@/components/image-info";
import { useStudio } from "@/components/studio-provider";
import { ChatPanel } from "@/components/studio/chat-panel";
import { Composer } from "@/components/studio/composer";
import {
  addRefs,
  editImageIds,
  videoContext,
  fromImage,
  hasPads,
  initialComposer,
  NO_PADS,
  purposeOf,
  startEdit,
  startVideo,
  toParams,
  type ComposerState,
} from "@/components/studio/composer-state";
import { EditStage, type SamPoint, type Tool } from "@/components/studio/edit-stage";
import { EditToolbar } from "@/components/studio/edit-toolbar";
import { Strip } from "@/components/studio/strip";
import { Lineage, useTree, VersionTree } from "@/components/studio/version-tree";
import { Viewer, type Selection } from "@/components/studio/viewer";
import { IconButton } from "@/components/ui";

const PREFS_KEY = "studio.composer";
const DEFAULT_PRESETS: Record<PresetPurpose, string> = { generate: "qwen-general", edit: "qwen-edit", video: "h3-video" };

export default function StudioPage() {
  const { jobs, recent, presets, subscribe } = useStudio();
  const [composer, setComposer] = useState<ComposerState>(initialComposer);
  const [presetIds, setPresetIds] = useState(DEFAULT_PRESETS);
  const [selection, setSelection] = useState<Selection>(null);
  const [panel, setPanel] = useState<"info" | "tree" | null>(null);
  const [showChat, setShowChat] = useState(true);
  const [autoExpand, setAutoExpand] = useState(false);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Selection tools. The mask belongs to one source image; editing another starts a fresh one.
  const [tool, setToolState] = useState<Tool>("whole");
  const [brushSize, setBrushSize] = useState(48);
  const maskRef = useRef<{ id: string; canvas: HTMLCanvasElement } | null>(null);
  const [maskVersion, setMaskVersion] = useState(0);
  const [maskOwner, setMaskOwner] = useState<string | null>(null);
  const [sam, setSam] = useState<{ id: string; points: SamPoint[] }>({ id: "", points: [] });
  const [samBusy, setSamBusy] = useState(false);
  const [samError, setSamError] = useState<string>();
  const [samReady, setSamReady] = useState(false);
  // Images reached through the version tree may be older than `recent`.
  const [known, setKnown] = useState<Map<string, ImageRecord>>(new Map());

  const lookup = useCallback((id: string) => recent.find((r) => r.id === id) ?? known.get(id), [recent, known]);
  const remember = useCallback((imgs: ImageRecord[]) => {
    setKnown((m) => {
      const next = new Map(m);
      for (const i of imgs) next.set(i.id, i);
      return next;
    });
  }, []);

  /** Load an image's settings into the composer, fetching its edit inputs if needed. */
  const loadFromImage = useCallback(
    async (img: ImageRecord, lockSeed: boolean) => {
      const v = img.params.video;
      const ids = [img.params.sourceImageId, ...(img.params.refImageIds ?? []), v?.firstFrameId, v?.lastFrameId].filter(
        (x): x is string => !!x,
      );
      const fetched = await Promise.all(ids.map((id) => lookup(id) ?? api.image(id).catch(() => undefined)));
      const found = fetched.filter((x): x is ImageRecord => !!x);
      remember(found);
      const map = new Map(found.map((f) => [f.id, f]));
      setComposer(fromImage(img, lockSeed, (id) => map.get(id)));
    },
    [lookup, remember],
  );

  // Restore per-browser preferences, then handle links from the gallery (?reuse= / ?edit=).
  useEffect(() => {
    // Browser storage only exists after hydration, so restoring it has to happen in an effect.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
      if (saved) {
        setComposer((s) => ({
          ...s,
          ...saved.composer,
          // Saved before speeds existed (its steps were for 8-step Turbo) or before pi-H3 became
          // the default: take the new default's speed and steps.
          video: {
            ...s.video,
            ...saved.composer?.video,
            ...(saved.composer?.video?.speed && saved.speedRev === VIDEO_SPEED_REV ? {} : { speed: s.video.speed, steps: s.video.steps }),
          },
          // Always open on images; video only comes from a link (?video= / ?continue=).
          mode: "image",
          prompt: "",
          origin: undefined,
          edit: undefined,
        }));
        if (saved.presetIds) setPresetIds({ ...DEFAULT_PRESETS, ...saved.presetIds });
        if (typeof saved.showChat === "boolean") setShowChat(saved.showChat);
        if (typeof saved.autoExpand === "boolean") setAutoExpand(saved.autoExpand);
      }
    } catch {}
    // On a phone the assistant covers the whole screen, so it starts closed.
    if (isPhone()) setShowChat(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    const sp = new URLSearchParams(window.location.search);
    const reuse = sp.get("reuse");
    const edit = sp.get("edit");
    const video = sp.get("video");
    const cont = sp.get("continue");
    const target = reuse ?? edit ?? video ?? cont;
    if (target) {
      api.image(target).then((img) => {
        remember([img]);
        setSelection({ kind: "image", id: img.id });
        if (reuse) void loadFromImage(img, sp.get("seed") === "1");
        else if (edit) setComposer((s) => startEdit(s, img));
        else if (video) setComposer((s) => startVideo(s, img));
        else void continueFrom(img);
      });
      window.history.replaceState(null, "", "/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { aspect, megapixels, customSize, steps, cfg, sampler, scheduler, denoise, count, negativePrompt, loras } = composer;
    const { seconds, speed, sampler: vSampler, scheduler: vScheduler } = composer.video;
    const video = { seconds, megapixels: composer.video.megapixels, speed, steps: composer.video.steps, sampler: vSampler, scheduler: vScheduler };
    const saved = { aspect, megapixels, customSize, steps, cfg, sampler, scheduler, denoise, count, negativePrompt, loras, video };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ composer: saved, presetIds, showChat, autoExpand, speedRev: VIDEO_SPEED_REV }));
    } catch {}
  }, [composer, presetIds, showChat, autoExpand]);

  // Each mode keeps its own preset; fall back to the first one of that purpose if it was deleted.
  const purpose = purposeOf(composer);
  const presetId = useMemo(() => {
    const want = presetIds[purpose];
    const pool = presets.filter((p) => p.purpose === purpose);
    return pool.some((p) => p.id === want) ? want : (pool[0]?.id ?? want);
  }, [presets, presetIds, purpose]);
  const setPresetId = (id: string) => setPresetIds((p) => ({ ...p, [purpose]: id }));

  const pendingJobs = useMemo(
    () =>
      jobs.filter((j) =>
        // Batches are followed on their own page; only the one running shows here.
        j.params.batch
          ? j.status === "running"
          : j.status === "queued" || j.status === "running" || (j.status === "error" && Date.now() - j.createdAt < 10 * 60_000),
      ),
    [jobs],
  );

  // What the stage shows: a job turns into its image as soon as it finishes.
  const selJob = selection?.kind === "job" ? jobs.find((j) => j.id === selection.id) : undefined;
  const selImageId = selection?.kind === "image" ? selection.id : selJob?.imageId;
  const selImage = selImageId ? lookup(selImageId) : undefined;
  // Uploads are inputs, not results: they stay out of the strip and aren't shown by default.
  const made = useMemo(() => recent.filter((r) => r.tool !== "upload"), [recent]);
  const shownImage = selImage ?? (selection ? undefined : made[0]);
  const queuePosition =
    selJob?.status === "queued"
      ? jobs.filter((j) => (j.status === "queued" || j.status === "running") && j.createdAt < selJob.createdAt).length
      : undefined;
  const tree = useTree(shownImage?.id);
  const source = composer.edit?.source;
  const stageEditing = !!shownImage && source?.id === shownImage.id;
  const hasMask = !!source && maskOwner === source.id;
  const region: "whole" | "mask" | "outpaint" = tool === "outpaint" ? "outpaint" : hasMask ? "mask" : "whole";

  function maskFor(img: { id: string; width: number; height: number }) {
    if (maskRef.current?.id !== img.id) maskRef.current = { id: img.id, canvas: createMask(img.width, img.height) };
    return maskRef.current.canvas;
  }
  const samPoints = source && sam.id === source.id ? sam.points : [];

  function resetSelection() {
    if (maskRef.current) clearMask(maskRef.current.canvas);
    setMaskOwner(null);
    setSam({ id: "", points: [] });
    setMaskVersion((v) => v + 1);
  }

  function setTool(t: Tool) {
    if (t === "whole") resetSelection();
    setToolState(t);
    setComposer((s) =>
      s.edit ? { ...s, edit: { ...s.edit, outpaint: t === "outpaint" ? (s.edit.outpaint ?? NO_PADS) : undefined } } : s,
    );
  }

  async function samClick(point: SamPoint) {
    if (!source) return;
    const points = [...samPoints, point];
    setSam({ id: source.id, points });
    setSamBusy(true);
    setSamError(undefined);
    try {
      const { mask } = await api.sam(source.id, points);
      await loadMask(maskFor(source), mask);
      setMaskOwner(source.id);
      setMaskVersion((v) => v + 1);
    } catch (e) {
      setSamError(e instanceof Error ? e.message : String(e));
    } finally {
      setSamBusy(false);
    }
  }

  // Click-to-select needs a one-time model download; check until it is there.
  useEffect(() => {
    if (samReady) return;
    const check = () => api.samReady().then((r) => r.ready && setSamReady(true), () => {});
    void check();
    const t = setInterval(check, 15_000);
    return () => clearInterval(t);
  }, [samReady]);

  // Iterative editing: when a single edit of the current target finishes, the
  // result becomes the next target, like continuing a conversation.
  const followJob = useRef<string | null>(null);
  useEffect(
    () =>
      subscribe((ev) => {
        if (ev.type !== "job" || ev.job.id !== followJob.current || ev.job.status !== "done" || !ev.job.imageId) return;
        followJob.current = null;
        const imageId = ev.job.imageId;
        api.image(imageId).then((img) => {
          remember([img]);
          setComposer((s) =>
            s.edit && s.edit.source.id === ev.job.params.sourceImageId
              ? { ...s, prompt: "", origin: undefined, edit: { ...s.edit, source: img, outpaint: s.edit.outpaint && NO_PADS } }
              : s,
          );
        });
      }),
    [subscribe, remember],
  );

  const generate = useCallback(
    async (override?: { prompt: string; origin: PromptOrigin }) => {
      const state = override ? { ...composer, prompt: override.prompt, origin: override.origin } : composer;
      const outpaint = state.edit && hasPads(state.edit.outpaint);
      if (!state.prompt.trim() && !outpaint) return;
      const mask = !outpaint && state.edit && maskOwner === state.edit.source.id ? maskRef.current?.canvas : undefined;
      if (mask && maskIsEmpty(mask)) return setError("選取範圍是空的，請先塗或點選要改的地方，或切回「整張」。");
      setError(undefined);
      setSubmitting(true);
      try {
        const created = await api.generate({
          params: toParams(state),
          count: state.count,
          origin: state.origin,
          mask: mask ? exportMask(mask) : undefined,
        });
        setSelection({ kind: "job", id: created[0].id });
        followJob.current = state.edit && created.length === 1 ? created[0].id : null;
        setPanel(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSubmitting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [composer, presetId, presets, maskOwner],
  );

  function originForChat(chat: ChatMessage[]) {
    const preset = presets.find((p) => p.id === presetId);
    return {
      idea: chat.find((m) => m.role === "user")?.content,
      presetId,
      presetName: preset?.name,
      systemPrompt: preset?.content,
      chat,
    };
  }

  function applyChatPrompt(prompt: string, chat: ChatMessage[], andGenerate: boolean) {
    setComposer((s) => ({ ...s, prompt, origin: originForChat(chat) }));
    if (isPhone()) setShowChat(false);
    if (andGenerate) void generate({ prompt, origin: originForChat(chat) });
  }

  function selectImage(img: ImageRecord) {
    remember([img]);
    setSelection({ kind: "image", id: img.id });
  }

  function makeVideo(img: ImageRecord) {
    remember([img]);
    setSelection({ kind: "image", id: img.id });
    setComposer((s) => startVideo(s, img));
  }

  /** The next clip starts where this video ends. */
  async function continueFrom(video: ImageRecord) {
    setError(undefined);
    try {
      const frame = await api.frame(video.id, "last");
      remember([frame]);
      setComposer((s) => startVideo(s, frame));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function edit(img: ImageRecord) {
    if (img.media === "video") return;
    remember([img]);
    setSelection({ kind: "image", id: img.id });
    setComposer((s) => startEdit(s, img));
  }

  /** Dropped, pasted or picked files: add them as references, or start editing the first. */
  const upload = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (!images.length) return;
      setError(undefined);
      try {
        const saved = await api.upload(images);
        remember(saved);
        if (composer.mode === "video") {
          // First drop fills the first frame, the next one the end frame.
          setComposer((s) =>
            s.video.first ? { ...s, video: { ...s.video, last: saved[0] } } : startVideo(s, saved[0]),
          );
          setSelection({ kind: "image", id: saved[0].id });
          return;
        }
        setComposer((s) => (s.edit ? addRefs(s, saved) : addRefs(startEdit(s, saved[0]), saved.slice(1))));
        if (!composer.edit) setSelection({ kind: "image", id: saved[0].id });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [composer.edit, composer.mode, remember],
  );

  // Paste an image from the clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void upload(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [upload]);

  // E: edit the image on stage. I: toggle its info. Esc: close the side panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "e" && shownImage?.media === "image" && composer.edit?.source.id !== shownImage.id) edit(shownImage);
      else if (e.key === "i" && shownImage) setPanel((p) => (p ? null : "info"));
      else if (e.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="relative flex h-full"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void upload([...e.dataTransfer.files]);
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2 md:p-4">
        {shownImage && (
          <Lineage tree={tree} currentId={shownImage.id} onSelect={selectImage} onShowTree={() => setPanel("tree")} />
        )}
        {stageEditing && source && (
          <EditToolbar
            tool={tool}
            setTool={setTool}
            brushSize={brushSize}
            setBrushSize={setBrushSize}
            hasMask={hasMask}
            onInvert={() => {
              invertMask(maskFor(source));
              setMaskOwner(maskIsEmpty(maskFor(source)) ? null : source.id);
              setSam({ id: "", points: [] });
              setMaskVersion((v) => v + 1);
            }}
            onClear={resetSelection}
            samReady={samReady}
            samBusy={samBusy}
            samError={samError}
            onPads={(p) => setComposer((s) => (s.edit ? { ...s, edit: { ...s.edit, outpaint: p } } : s))}
            width={source.width}
            height={source.height}
          />
        )}
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="relative min-w-0 flex-1">
            <Viewer
              image={shownImage}
              job={selJob}
              queuePosition={queuePosition}
              showInfo={panel !== null}
              onToggleInfo={() => setPanel((p) => (p ? null : "info"))}
              editing={stageEditing}
              onEdit={edit}
              onMakeVideo={makeVideo}
              onContinue={(v) => void continueFrom(v)}
              stage={
                stageEditing && source ? (
                  <EditStage
                    image={source}
                    tool={tool}
                    brushSize={brushSize}
                    mask={maskFor(source)}
                    maskVersion={maskVersion}
                    onStroke={() => {
                      const m = maskFor(source);
                      setMaskOwner(maskIsEmpty(m) ? null : source.id);
                    }}
                    samPoints={samPoints}
                    onSamClick={samClick}
                    pads={composer.edit?.outpaint ?? NO_PADS}
                    onPads={(p) => setComposer((s) => (s.edit ? { ...s, edit: { ...s.edit, outpaint: p } } : s))}
                    busy={samBusy}
                  />
                ) : undefined
              }
            />
            <IconButton
              label={showChat ? "收起 Prompt 助手" : "打開 Prompt 助手"}
              onClick={() => setShowChat((v) => !v)}
              className="absolute top-0 right-0 bg-panel/80"
            >
              {showChat ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            </IconButton>
          </div>
          {panel && shownImage && (
            <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/60 max-md:fixed max-md:inset-x-2 max-md:top-2 max-md:bottom-16 max-md:z-40 md:w-80 md:shadow-none">
              <div className="flex items-center gap-1 border-b border-line p-2">
                {(["info", "tree"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setPanel(k)}
                    className={`rounded-md px-3 py-1 text-xs ${panel === k ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
                  >
                    {k === "info" ? "資訊" : `版本樹${tree.length > 1 ? `（${tree.length}）` : ""}`}
                  </button>
                ))}
                <IconButton label="關閉 (Esc)" className="ml-auto" onClick={() => setPanel(null)}>
                  <X className="size-4" />
                </IconButton>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {panel === "info" ? (
                  <ImageInfo
                    image={shownImage}
                    onReuse={(img, lockSeed) => void loadFromImage(img, lockSeed)}
                    onEdit={edit}
                    onMakeVideo={makeVideo}
                    onContinue={(v) => void continueFrom(v)}
                    onDeleted={() => {
                      setSelection(null);
                      setPanel(null);
                      setComposer((s) => (s.edit?.source.id === shownImage.id ? { ...s, edit: undefined } : s));
                    }}
                  />
                ) : (
                  <VersionTree tree={tree} currentId={shownImage.id} onSelect={selectImage} />
                )}
              </div>
            </div>
          )}
        </div>

        <Strip
          jobs={pendingJobs}
          images={made}
          selection={selection ?? (shownImage ? { kind: "image", id: shownImage.id } : null)}
          onSelect={setSelection}
          onAddRef={composer.edit ? (img) => setComposer((s) => addRefs(s, [img])) : undefined}
          usedIds={editImageIds(composer)}
        />

        {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}

        <Composer
          state={composer}
          setState={setComposer}
          presetId={presetId}
          setPresetId={setPresetId}
          onGenerate={(override) => generate(override)}
          onUpload={upload}
          region={region}
          busy={submitting}
          autoExpand={autoExpand}
          setAutoExpand={setAutoExpand}
        />
      </div>

      {showChat && (
        <ChatPanel
          onClose={() => setShowChat(false)}
          presetId={presetId}
          setPresetId={setPresetId}
          purpose={purpose}
          imageIds={editImageIds(composer)}
          video={videoContext(composer)}
          onUsePrompt={applyChatPrompt}
        />
      )}

      {dragging && composer.mode === "video" ? (
        <div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent-strong/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-accent">
            <ImageDown className="size-10" />
            <p className="text-base font-medium">{composer.video.first ? "放開以設為結尾幀" : "放開以設為影片的第一幀"}</p>
          </div>
        </div>
      ) : dragging && (
        <div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent-strong/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-accent">
            <ImageDown className="size-10" />
            <p className="text-base font-medium">{composer.edit ? "放開以加入參考圖" : "放開以開始修改這張圖"}</p>
          </div>
        </div>
      )}
    </div>
  );
}

const isPhone = () => window.matchMedia("(max-width: 767px)").matches;
