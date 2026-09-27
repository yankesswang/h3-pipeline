"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { api } from "@/lib/client/api";
import type { ChatMessage, ImageRecord } from "@/lib/shared/types";
import { ImageInfo } from "@/components/image-info";
import { useStudio } from "@/components/studio-provider";
import { ChatPanel } from "@/components/studio/chat-panel";
import { Composer } from "@/components/studio/composer";
import { fromImage, initialComposer, toParams, type ComposerState } from "@/components/studio/composer-state";
import { Strip } from "@/components/studio/strip";
import { Viewer, type Selection } from "@/components/studio/viewer";
import { IconButton } from "@/components/ui";

const PREFS_KEY = "studio.composer";

export default function StudioPage() {
  const { jobs, recent, presets } = useStudio();
  const [composer, setComposer] = useState<ComposerState>(initialComposer);
  const [presetId, setPresetId] = useState("qwen-general");
  const [selection, setSelection] = useState<Selection>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  // Restore per-browser preferences, then handle "reuse this image" links from the gallery.
  useEffect(() => {
    // Browser storage only exists after hydration, so restoring it has to happen in an effect.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
      if (saved) {
        setComposer((s) => ({ ...s, ...saved.composer, prompt: "", origin: undefined }));
        if (saved.presetId) setPresetId(saved.presetId);
        if (typeof saved.showChat === "boolean") setShowChat(saved.showChat);
      }
    } catch {}
    const sp = new URLSearchParams(window.location.search);
    const reuse = sp.get("reuse");
    if (reuse) {
      api.image(reuse).then((img) => {
        setComposer(fromImage(img, sp.get("seed") === "1"));
        setSelection({ kind: "image", id: img.id });
      });
      window.history.replaceState(null, "", "/");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    const { aspect, megapixels, steps, cfg, count, negativePrompt } = composer;
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ composer: { aspect, megapixels, steps, cfg, count, negativePrompt }, presetId, showChat }),
      );
    } catch {}
  }, [composer, presetId, showChat]);

  // If the stored preset was deleted, fall back to the first one.
  const activePresetId = presets.length && !presets.some((p) => p.id === presetId) ? presets[0].id : presetId;

  const pendingJobs = useMemo(
    () => jobs.filter((j) => j.status === "queued" || j.status === "running" || (j.status === "error" && Date.now() - j.createdAt < 10 * 60_000)),
    [jobs],
  );

  // What the stage shows: a job turns into its image as soon as it finishes.
  const selJob = selection?.kind === "job" ? jobs.find((j) => j.id === selection.id) : undefined;
  const selImageId = selection?.kind === "image" ? selection.id : selJob?.imageId;
  const selImage = selImageId ? recent.find((i) => i.id === selImageId) : undefined;
  const shownImage = selImage ?? (selection ? undefined : recent[0]);
  const queuePosition = selJob?.status === "queued" ? jobs.filter((j) => (j.status === "queued" || j.status === "running") && j.createdAt < selJob.createdAt).length : undefined;

  const generate = useCallback(
    async (override?: { prompt: string; chat: ChatMessage[] }) => {
      const state = override
        ? {
            ...composer,
            prompt: override.prompt,
            origin: originForChat(override.chat),
          }
        : composer;
      if (!state.prompt.trim()) return;
      setError(undefined);
      setSubmitting(true);
      try {
        const created = await api.generate({ params: toParams(state), count: state.count, origin: state.origin });
        setSelection({ kind: "job", id: created[0].id });
        setShowInfo(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSubmitting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [composer, activePresetId, presets],
  );

  function originForChat(chat: ChatMessage[]) {
    const preset = presets.find((p) => p.id === activePresetId);
    return {
      idea: chat.find((m) => m.role === "user")?.content,
      presetId: activePresetId,
      presetName: preset?.name,
      systemPrompt: preset?.content,
      chat,
    };
  }

  function applyChatPrompt(prompt: string, chat: ChatMessage[], andGenerate: boolean) {
    setComposer((s) => ({ ...s, prompt, origin: originForChat(chat) }));
    if (andGenerate) void generate({ prompt, chat });
  }

  function reuse(img: ImageRecord, lockSeed: boolean) {
    setComposer(fromImage(img, lockSeed));
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="relative min-w-0 flex-1">
            <Viewer
              image={shownImage}
              job={selJob}
              queuePosition={queuePosition}
              showInfo={showInfo}
              onToggleInfo={() => setShowInfo((v) => !v)}
            />
            <IconButton
              label={showChat ? "收起 Prompt 助手" : "打開 Prompt 助手"}
              onClick={() => setShowChat((v) => !v)}
              className="absolute top-0 right-0 bg-panel/80"
            >
              {showChat ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            </IconButton>
          </div>
          {showInfo && shownImage && (
            <div className="w-80 shrink-0 overflow-y-auto rounded-xl border border-line bg-panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-medium">圖片資訊</h2>
                <IconButton label="關閉" onClick={() => setShowInfo(false)}>
                  <X className="size-4" />
                </IconButton>
              </div>
              <ImageInfo
                image={shownImage}
                onReuse={reuse}
                onDeleted={() => {
                  setSelection(null);
                  setShowInfo(false);
                }}
              />
            </div>
          )}
        </div>

        <Strip
          jobs={pendingJobs}
          images={recent}
          selection={selection ?? (shownImage ? { kind: "image", id: shownImage.id } : null)}
          onSelect={setSelection}
        />

        {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}

        <Composer
          state={composer}
          setState={setComposer}
          presetId={activePresetId}
          setPresetId={setPresetId}
          onGenerate={() => generate()}
          busy={submitting}
        />
      </div>

      {showChat && <ChatPanel presetId={activePresetId} setPresetId={setPresetId} onUsePrompt={applyChatPrompt} />}
    </div>
  );
}
