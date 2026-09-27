"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ImageIcon, Info, Loader2, Pencil, X } from "lucide-react";
import { api, imageUrl } from "@/lib/client/api";
import type { ImageRecord, Job } from "@/lib/shared/types";

export type Selection = { kind: "image"; id: string } | { kind: "job"; id: string } | null;

/** The big stage: the selected image, or a live progress card for a running job. */
export function Viewer({
  image,
  job,
  queuePosition,
  showInfo,
  onToggleInfo,
  editing,
  onEdit,
  stage,
}: {
  image?: ImageRecord;
  job?: Job;
  queuePosition?: number;
  showInfo: boolean;
  onToggleInfo: () => void;
  /** This image is the current edit target. */
  editing: boolean;
  onEdit: (img: ImageRecord) => void;
  /** Replaces the plain image while it is being edited (selection tools, outpaint frame). */
  stage?: ReactNode;
}) {
  if (job && !image) return <JobStage job={job} queuePosition={queuePosition} />;

  if (!image)
    return (
      <div className="grid h-full place-items-center text-faint">
        <div className="flex flex-col items-center gap-3">
          <ImageIcon className="size-10" strokeWidth={1} />
          <p>在下方輸入想法，或和右側的 Prompt 助手聊聊</p>
          <p className="text-xs">也可以把圖片拖進來或貼上（Ctrl+V）來修改</p>
        </div>
      </div>
    );

  return (
    <div className="group relative flex h-full items-center justify-center">
      {stage ?? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={image.id}
          src={imageUrl(image.id)}
          alt={image.params.prompt}
          className="checker max-h-full max-w-full rounded-lg object-contain shadow-2xl shadow-black/50"
        />
      )}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-black/60 p-1 backdrop-blur">
        {editing ? (
          <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-accent">
            <Pencil className="size-3.5" /> 正在修改這張
          </span>
        ) : (
          <button
            onClick={() => onEdit(image)}
            className="flex items-center gap-1.5 rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-medium text-white hover:bg-accent"
            title="修改這張（E）"
          >
            <Pencil className="size-3.5" /> 修改這張
          </button>
        )}
        <button
          onClick={onToggleInfo}
          title="圖片資訊與版本（I）"
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${showInfo ? "bg-raised text-fg" : "text-fg hover:bg-white/10"}`}
        >
          <Info className="size-3.5" /> 資訊與版本
        </button>
      </div>
    </div>
  );
}

function JobStage({ job, queuePosition }: { job: Job; queuePosition?: number }) {
  const ratio = job.params.width / job.params.height;
  return (
    <div className="flex h-full items-center justify-center">
      <div
        className={`relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-lg border border-line ${
          job.status === "running" ? "shimmer" : "bg-panel"
        }`}
        style={{ aspectRatio: ratio, height: ratio >= 1 ? undefined : "100%", width: ratio >= 1 ? "min(100%, 720px)" : undefined }}
      >
        <div className="flex max-w-sm flex-col items-center gap-3 p-6 text-center">
          {job.status === "error" ? (
            <>
              <AlertTriangle className="size-8 text-bad" />
              <p className="text-bad">生成失敗</p>
              <p className="text-xs break-all text-muted">{job.error}</p>
            </>
          ) : job.status === "cancelled" ? (
            <p className="text-muted">已取消</p>
          ) : (
            <>
              <Loader2 className="size-7 animate-spin text-accent" />
              <p className="text-fg">
                {job.status === "queued" ? `排隊中${queuePosition ? `（前面還有 ${queuePosition} 張）` : ""}` : (job.stage ?? "處理中")}
              </p>
              {job.status === "running" && (
                <div className="h-1.5 w-56 overflow-hidden rounded-full bg-raised">
                  <div className="h-full bg-accent-strong transition-[width]" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                </div>
              )}
              <p className="line-clamp-3 text-xs text-faint">{job.params.prompt}</p>
              <button
                onClick={() => api.cancelJob(job.id)}
                className="mt-1 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-raised hover:text-fg"
              >
                <X className="size-3" /> 取消
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
