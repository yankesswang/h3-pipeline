"use client";

import { AlertTriangle, Heart, Loader2, Plus } from "lucide-react";
import { imageUrl } from "@/lib/client/api";
import type { ImageRecord, Job } from "@/lib/shared/types";
import type { Selection } from "./viewer";

/** Filmstrip: pending jobs first, then recent images. */
export function Strip({
  jobs,
  images,
  selection,
  onSelect,
  onAddRef,
  usedIds,
}: {
  jobs: Job[];
  images: ImageRecord[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** In edit mode: add a thumbnail as a reference image. */
  onAddRef?: (img: ImageRecord) => void;
  /** Images already in the edit, marked in the strip. */
  usedIds: string[];
}) {
  const isSel = (kind: "image" | "job", id: string) => selection?.kind === kind && selection.id === id;
  if (jobs.length === 0 && images.length === 0) return null;

  return (
    <div className="flex h-20 shrink-0 gap-2 overflow-x-auto px-1 py-1">
      {jobs.map((j) => (
        <button
          key={j.id}
          onClick={() => onSelect({ kind: "job", id: j.id })}
          className={`relative grid aspect-square h-full shrink-0 place-items-center rounded-lg border ${
            j.status === "error" ? "border-bad/50 bg-bad/10" : "border-line " + (j.status === "running" ? "shimmer" : "bg-panel")
          } ${isSel("job", j.id) ? "ring-2 ring-accent" : ""}`}
          title={j.status === "error" ? j.error : j.params.prompt}
        >
          {j.status === "error" ? (
            <AlertTriangle className="size-5 text-bad" />
          ) : j.status === "running" ? (
            <span className="text-xs text-accent tabular-nums">{Math.round(j.progress * 100)}%</span>
          ) : (
            <Loader2 className="size-4 animate-spin text-faint" />
          )}
        </button>
      ))}
      {images.map((img) => {
        const used = usedIds.indexOf(img.id);
        return (
          <div key={img.id} className="group relative h-full shrink-0" style={{ aspectRatio: img.width / img.height }}>
            <button
              onClick={() => onSelect({ kind: "image", id: img.id })}
              className={`relative block h-full w-full overflow-hidden rounded-lg border transition hover:border-muted ${
                used >= 0 ? "border-accent" : "border-line"
              } ${isSel("image", img.id) ? "ring-2 ring-accent" : ""}`}
              title={img.params.prompt}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(img.id, 160)} alt="" loading="lazy" className="h-full w-full object-cover" />
              {img.favorite && <Heart className="absolute right-1 bottom-1 size-3 fill-bad text-bad" />}
              {used >= 0 && (
                <span className="absolute top-0.5 left-0.5 rounded bg-accent-strong px-1 font-mono text-[9px] text-white">{used + 1}</span>
              )}
            </button>
            {onAddRef && used < 0 && (
              <button
                onClick={() => onAddRef(img)}
                title="加為參考圖"
                className="absolute top-0.5 right-0.5 hidden size-5 place-items-center rounded-md bg-black/70 text-fg group-hover:grid hover:bg-accent-strong"
              >
                <Plus className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
