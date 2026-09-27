"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageDown, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { api } from "@/lib/client/api";
import type { ChatMessage, ImageRecord, PresetPurpose } from "@/lib/shared/types";
import { ImageInfo } from "@/components/image-info";
import { useStudio } from "@/components/studio-provider";
import { ChatPanel } from "@/components/studio/chat-panel";
import { Composer } from "@/components/studio/composer";
import {
  addRefs,
  editImageIds,
  fromImage,
  initialComposer,
  purposeOf,
  startEdit,
  toParams,
  type ComposerState,
} from "@/components/studio/composer-state";
import { Strip } from "@/components/studio/strip";
import { Lineage, useTree, VersionTree } from "@/components/studio/version-tree";
import { Viewer, type Selection } from "@/components/studio/viewer";
import { IconButton } from "@/components/ui";

const PREFS_KEY = "studio.composer";
const DEFAULT_PRESETS: Record<PresetPurpose, string> = { generate: "qwen-general", edit: "qwen-edit" };

export default function StudioPage() {
  const { jobs, recent, presets, subscribe } = useStudio();
  const [composer, setComposer] = useState<ComposerState>(initialComposer);
  const [presetIds, setPresetIds] = useState(DEFAULT_PRESETS);
  const [selection, setSelection] = useState<Selection>(null);
  const [panel, setPanel] = useState<"info" | "tree" | null>(null);
  const [showChat, setShowChat] = useState(true);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
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
      const ids = [img.params.sourceImageId, ...(img.params.refImageIds ?? [])].filter((x): x is string => !!x);
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
        setComposer((s) => ({ ...s, ...saved.composer, prompt: "", origin: undefined, edit: undefined }));
        if (saved.presetIds) setPresetIds({ ...DEFAULT_PRESETS, ...saved.presetIds });
        if (typeof saved.showChat === "boolean") setShowChat(saved.showChat);
      }
    } catch {}
    /* eslint-enable react-hooks/set-state-in-effect */
    const sp = new URLSearchParams(window.location.search);
    const reuse = sp.get("reuse");
    const edit = sp.get("edit");
    if (reuse || edit) {
      api.image((reuse ?? edit)!).then((img) => {
        remember([img]);
        setSelection({ kind: "image", id: img.id });
        if (reuse) void loadFromImage(img, sp.get("seed") === "1");
        else setComposer((s) => startEdit(s, img));
      });
      window.history.replaceState(null, "", "/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { aspect, megapixels, steps, cfg, count, negativePrompt } = composer;
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ composer: { aspect, megapixels, steps, cfg, count, negativePrompt }, presetIds, showChat }),
      );
    } catch {}
  }, [composer, presetIds, showChat]);

  // Each mode keeps its own preset; fall back to the first one of that purpose if it was deleted.
  const purpose = purposeOf(composer);
  const presetId = useMemo(() => {
    const want = presetIds[purpose];
    const pool = presets.filter((p) => p.purpose === purpose);
    return pool.some((p) => p.id === want) ? want : (pool[0]?.id ?? want);
  }, [presets, presetIds, purpose]);
  const setPresetId = (id: string) => setPresetIds((p) => ({ ...p, [purpose]: id }));

  const pendingJobs = useMemo(
    () => jobs.filter((j) => j.status === "queued" || j.status === "running" || (j.status === "error" && Date.now() - j.createdAt < 10 * 60_000)),
    [jobs],
  );

  // What the stage shows: a job turns into its image as soon as it finishes.
  const selJob = selection?.kind === "job" ? jobs.find((j) => j.id === selection.id) : undefined;
  const selImageId = selection?.kind === "image" ? selection.id : selJob?.imageId;
  const selImage = selImageId ? lookup(selImageId) : undefined;
  const shownImage = selImage ?? (selection ? undefined : recent[0]);
  const queuePosition =
    selJob?.status === "queued"
      ? jobs.filter((j) => (j.status === "queued" || j.status === "running") && j.createdAt < selJob.createdAt).length
      : undefined;
  const tree = useTree(shownImage?.id);

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
              ? { ...s, prompt: "", origin: undefined, edit: { ...s.edit, source: img } }
              : s,
          );
        });
      }),
    [subscribe, remember],
  );

  const generate = useCallback(
    async (override?: { prompt: string; chat: ChatMessage[] }) => {
      const state = override ? { ...composer, prompt: override.prompt, origin: originForChat(override.chat) } : composer;
      if (!state.prompt.trim()) return;
      setError(undefined);
      setSubmitting(true);
      try {
        const created = await api.generate({ params: toParams(state), count: state.count, origin: state.origin });
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
    [composer, presetId, presets],
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
    if (andGenerate) void generate({ prompt, chat });
  }

  function selectImage(img: ImageRecord) {
    remember([img]);
    setSelection({ kind: "image", id: img.id });
  }

  function edit(img: ImageRecord) {
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
        setComposer((s) => (s.edit ? addRefs(s, saved) : addRefs(startEdit(s, saved[0]), saved.slice(1))));
        if (!composer.edit) setSelection({ kind: "image", id: saved[0].id });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [composer.edit, remember],
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
      if (e.key === "e" && shownImage && composer.edit?.source.id !== shownImage.id) edit(shownImage);
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
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        {shownImage && (
          <Lineage tree={tree} currentId={shownImage.id} onSelect={selectImage} onShowTree={() => setPanel("tree")} />
        )}
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="relative min-w-0 flex-1">
            <Viewer
              image={shownImage}
              job={selJob}
              queuePosition={queuePosition}
              showInfo={panel !== null}
              onToggleInfo={() => setPanel((p) => (p ? null : "info"))}
              editing={!!shownImage && composer.edit?.source.id === shownImage.id}
              onEdit={edit}
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
            <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
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
          images={recent}
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
          onGenerate={() => generate()}
          onUpload={upload}
          busy={submitting}
        />
      </div>

      {showChat && (
        <ChatPanel
          presetId={presetId}
          setPresetId={setPresetId}
          purpose={purpose}
          imageIds={editImageIds(composer)}
          onUsePrompt={applyChatPrompt}
        />
      )}

      {dragging && (
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
