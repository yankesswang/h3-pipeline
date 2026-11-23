"use client";

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Check, Dices, Loader2, Lock, Plus, Upload, X, type LucideIcon } from "lucide-react";
import { api, imageUrl } from "@/lib/client/api";
import type { ImageRecord, Job } from "@/lib/shared/types";
import { useStudio } from "@/components/studio-provider";
import { Button, Chip, IconButton, inputCls } from "@/components/ui";

// Building blocks shared by the step-by-step pages (image and video): the
// header with its step tracker, step cards, image pickers, the page's own job
// list, and dropping or pasting images.

export interface StepState {
  label: string;
  done: boolean;
}

export function WorkflowHeader({ icon: Icon, title, subtitle, steps }: { icon: LucideIcon; title: string; subtitle: string; steps: StepState[] }) {
  return (
    <header className="border-b border-line px-5 pt-4 pb-3">
      <h1 className="flex items-center gap-2 text-base font-semibold">
        <Icon className="size-5 text-accent" /> {title}
      </h1>
      <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
      <ol className="mt-3 flex items-center gap-1">
        {steps.map((s, i) => (
          <li key={s.label} className="flex flex-1 items-center gap-1">
            <span
              className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-medium ${
                s.done ? "bg-accent-strong text-white" : "bg-raised text-muted"
              }`}
            >
              {s.done ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={`text-[11px] ${s.done ? "text-fg" : "text-muted"}`}>{s.label}</span>
            {i < steps.length - 1 && <span className={`h-px flex-1 ${s.done ? "bg-accent/60" : "bg-line"}`} />}
          </li>
        ))}
      </ol>
    </header>
  );
}

export function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-bg/40 p-3">
      <h2 className="mb-2.5 flex items-baseline gap-2">
        <span className="font-mono text-xs text-accent">{n}</span>
        <span className="text-sm font-medium">{title}</span>
        {hint && <span className="text-xs text-faint">{hint}</span>}
      </h2>
      {children}
    </section>
  );
}

/** Two choices side by side, e.g. text or image as the starting point. */
export function SourceTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly (readonly [T, string, LucideIcon])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg bg-raised p-0.5">
      {options.map(([id, label, Icon]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition ${
            value === id ? "bg-accent-strong text-white" : "text-muted hover:text-fg"
          }`}
        >
          <Icon className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

/** One image input: pick from recent images or upload one. */
export function ImageSlot({
  label,
  required,
  small,
  img,
  onPick,
  onClear,
}: {
  label: string;
  required?: boolean;
  /** A compact add button (for reference images). */
  small?: boolean;
  img?: ImageRecord;
  onPick: (img: ImageRecord) => void;
  onClear: () => void;
}) {
  const { recent } = useStudio();
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const images = recent.filter((r) => r.media === "image");

  return (
    <div className="relative">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setUploading(true);
          try {
            const [saved] = await api.upload([file]);
            onPick(saved);
            setPicking(false);
          } finally {
            setUploading(false);
          }
        }}
      />
      {img ? (
        <div className="group relative">
          <button
            onClick={() => setPicking((v) => !v)}
            className="relative block h-24 overflow-hidden rounded-lg border border-accent"
            style={{ aspectRatio: img.width / img.height }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(img.id, 160)} alt="" className="h-full w-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 text-center text-[10px] leading-4">{label}</span>
          </button>
          <button
            onClick={onClear}
            title="移除"
            className="absolute -top-1.5 -right-1.5 hidden size-4 place-items-center rounded-full bg-bad text-white group-hover:grid pointer-coarse:grid"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setPicking((v) => !v)}
          className={`flex ${small ? "h-14 w-16" : "h-24 w-32"} flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs transition ${
            picking ? "border-accent text-accent" : required ? "border-accent/50 text-muted hover:text-fg" : "border-line text-muted hover:text-fg"
          }`}
        >
          <Plus className="size-4" /> {!small && label}
        </button>
      )}

      {picking && (
        <div className="absolute top-full left-0 z-20 mt-2 w-[min(420px,calc(100vw-2rem))] rounded-xl border border-line bg-raised p-3 shadow-2xl shadow-black/60">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-muted">選{label}</span>
            <div className="flex gap-1">
              <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} 上傳
              </Button>
              <IconButton label="關閉" onClick={() => setPicking(false)}>
                <X className="size-4" />
              </IconButton>
            </div>
          </div>
          <div className="grid max-h-64 grid-cols-4 gap-1.5 sm:grid-cols-5 overflow-y-auto">
            {images.length === 0 && <span className="col-span-5 text-xs text-faint">圖庫還沒有圖片，請上傳</span>}
            {images.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onPick(r);
                  setPicking(false);
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

/** A row of added images with an add button; `tag` labels each one (e.g. its <imageN> token). */
export function RefImages({
  refs,
  max,
  onAdd,
  onRemove,
  hint,
  label = "參考圖",
  tag,
}: {
  refs: ImageRecord[];
  max: number;
  onAdd: (imgs: ImageRecord[]) => void;
  onRemove: (id: string) => void;
  hint?: string;
  label?: string;
  tag?: (i: number) => string;
}) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">{label}</span>
      {refs.map((r, i) => (
        <div key={r.id} className="group relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl(r.id, 160)}
            alt=""
            title={r.params.prompt}
            className="h-14 rounded-lg border border-line object-cover"
            style={{ aspectRatio: r.width / r.height }}
          />
          {tag && (
            <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/70 text-center font-mono text-[10px] leading-4">{tag(i)}</span>
          )}
          <button
            onClick={() => onRemove(r.id)}
            title="移除"
            className="absolute -top-1.5 -right-1.5 hidden size-4 place-items-center rounded-full bg-bad text-white group-hover:grid pointer-coarse:grid"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      {refs.length < max && <ImageSlot label={label} small onPick={(img) => onAdd([img])} onClear={() => {}} />}
      {hint && <span className="basis-full text-[11px] text-faint">{hint}</span>}
    </div>
  );
}

/** Seed (fixed or random each run) and how many to make, as rows of a two-column grid. */
export function SeedCountRows({
  seed,
  seedLocked,
  count,
  counts = [1, 2, 4],
  unit,
  onChange,
}: {
  seed: number;
  seedLocked: boolean;
  count: number;
  counts?: number[];
  unit: string;
  onChange: (patch: { seed?: number; seedLocked?: boolean; count?: number }) => void;
}) {
  return (
    <>
      <label>Seed</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={seed}
          onChange={(e) => onChange({ seed: Number(e.target.value), seedLocked: true })}
          className={`${inputCls} !w-40 !py-1 font-mono text-xs`}
        />
        <IconButton label="換一個 seed" onClick={() => onChange({ seed: Math.floor(Math.random() * 2 ** 48) })}>
          <Dices className="size-4" />
        </IconButton>
        <Button variant="ghost" className={`!px-2 !py-1 text-xs ${seedLocked ? "text-accent" : ""}`} onClick={() => onChange({ seedLocked: !seedLocked })}>
          <Lock className="size-3.5" /> {seedLocked ? "固定" : "每次隨機"}
        </Button>
      </div>
      <label>數量</label>
      <div className="flex items-center gap-1">
        {counts.map((n) => (
          <Chip key={n} on={count === n} onClick={() => onChange({ count: n })}>
            ×{n}
          </Chip>
        ))}
        <span className="ml-2 text-faint">每{unit}用不同 seed</span>
      </div>
    </>
  );
}

/** Jobs started from this page, newest first, with progress and a cancel button. */
export function JobList({ jobs, showLabel, onShow }: { jobs: Job[]; showLabel: string; onShow: (imageId: string) => void }) {
  if (!jobs.length) return null;
  return (
    <ul className="mt-3 space-y-1.5">
      {jobs
        .slice()
        .reverse()
        .map((j) => {
          const active = j.status === "queued" || j.status === "running";
          return (
            <li key={j.id} className="rounded-lg bg-raised px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                {j.status === "done" ? (
                  <Check className="size-3.5 text-ok" />
                ) : j.status === "error" || j.status === "cancelled" ? (
                  <X className="size-3.5 text-bad" />
                ) : (
                  <Loader2 className="size-3.5 animate-spin text-accent" />
                )}
                <span className="truncate text-muted">{j.params.prompt.split("\n")[0]}</span>
                {j.status === "done" && j.imageId ? (
                  <button className="ml-auto shrink-0 text-accent hover:underline" onClick={() => onShow(j.imageId!)}>
                    {showLabel}
                  </button>
                ) : (
                  active && (
                    <button className="ml-auto shrink-0 text-faint hover:text-bad" onClick={() => api.cancelJob(j.id)}>
                      取消
                    </button>
                  )
                )}
              </div>
              {active && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded bg-line">
                    <div className="h-full bg-accent-strong transition-all" style={{ width: `${Math.round(j.progress * 100)}%` }} />
                  </div>
                  <span className="w-20 truncate text-right text-faint">{j.status === "queued" ? "排隊中" : j.stage}</span>
                </div>
              )}
              {j.error && <p className="mt-1 text-bad">{j.error}</p>}
            </li>
          );
        })}
    </ul>
  );
}

/**
 * Jobs started from this page: `track` records new ones, and `onDone` fires with
 * each finished result so the page can show it.
 */
export function usePageJobs(onDone: (imageId: string) => void) {
  const { jobs, subscribe } = useStudio();
  const [mine, setMine] = useState<string[]>([]);
  const mineRef = useRef<string[]>([]);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(
    () =>
      subscribe((ev) => {
        if (ev.type === "job" && ev.job.status === "done" && ev.job.imageId && mineRef.current.includes(ev.job.id))
          onDoneRef.current(ev.job.imageId);
      }),
    [subscribe],
  );
  const myJobs = jobs.filter((j) => mine.includes(j.id));
  return {
    myJobs,
    running: myJobs.filter((j) => j.status === "queued" || j.status === "running").length,
    done: myJobs.filter((j) => j.status === "done").length,
    track: (created: Job[]) => {
      mineRef.current = [...mineRef.current, ...created.map((j) => j.id)];
      setMine(mineRef.current);
    },
  };
}

/** Images dropped on the page or pasted with Ctrl+V go to `onFiles`. Spread `dropProps` on the page root. */
export function useImageDrop(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  });
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      onFilesRef.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);
  return {
    dragging,
    dropProps: {
      onDragOver: (e: DragEvent) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
        if (files.length) onFilesRef.current(files);
      },
    },
  };
}

export function DropOverlay({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-bg/80 text-sm text-accent">
      {text}
    </div>
  );
}

/** Recent results along the bottom of a page. */
export function RecentStrip({
  title,
  items,
  currentId,
  running,
  runningUnit,
  empty,
  onSelect,
}: {
  title: string;
  items: ImageRecord[];
  currentId?: string;
  running: number;
  runningUnit: string;
  empty: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="border-t border-line bg-panel px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        {title}
        {running > 0 && (
          <span className="text-accent">
            · {running} {runningUnit}生成中
          </span>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {items.length === 0 && <span className="text-xs text-faint">{empty}</span>}
        {items.map((v) => (
          <button
            key={v.id}
            onClick={() => onSelect(v.id)}
            title={v.params.prompt}
            className={`relative h-20 shrink-0 overflow-hidden rounded-lg border ${v.id === currentId ? "border-accent" : "border-line hover:border-muted"}`}
            style={{ aspectRatio: v.width / v.height }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(v.id, 160)} alt="" className="h-full w-full object-cover" />
            {v.media === "video" && (
              <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] tabular-nums">{v.duration?.toFixed(1)}s</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
