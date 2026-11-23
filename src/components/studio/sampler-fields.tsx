"use client";

import { Chip, inputCls } from "@/components/ui";
import { SAMPLERS, SCHEDULERS, VIDEO_MEGAPIXELS } from "@/lib/shared/sizes";
import type { VideoSpeed } from "@/lib/shared/types";
import { VIDEO_SPEEDS, videoSize } from "@/lib/tools/video";

// Controls shared by the studio composer and the video page. Each renders
// label + control pairs for a two-column grid.

const selectCls = `${inputCls} !w-auto !py-1 text-xs`;

/** A value from an older image may not be in the curated list; keep it selectable. */
const withValue = (list: readonly string[], v: string) => (list.includes(v) ? list : [v, ...list]);

export function SamplerRows({
  sampler,
  scheduler,
  defaults,
  hint,
  onChange,
}: {
  sampler: string;
  scheduler: string;
  defaults: { sampler: string; scheduler: string };
  hint: string;
  onChange: (patch: { sampler?: string; scheduler?: string }) => void;
}) {
  const changed = sampler !== defaults.sampler || scheduler !== defaults.scheduler;
  return (
    <>
      <label>Sampler</label>
      <div className="flex flex-wrap items-center gap-2">
        <select value={sampler} onChange={(e) => onChange({ sampler: e.target.value })} className={selectCls} title="採樣演算法">
          {withValue(SAMPLERS, sampler).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={scheduler} onChange={(e) => onChange({ scheduler: e.target.value })} className={selectCls} title="Scheduler：雜訊怎麼逐步去除">
          {withValue(SCHEDULERS, scheduler).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {changed ? (
          <button className="text-accent hover:underline" onClick={() => onChange(defaults)}>
            還原官方預設
          </button>
        ) : (
          <span className="text-faint">{hint}</span>
        )}
      </div>
    </>
  );
}

/** Video pixel budgets, labelled by the short edge they give at this aspect. */
export function VideoQualityChips({
  megapixels,
  aspect,
  onChange,
}: {
  megapixels: number;
  aspect: [number, number];
  onChange: (mp: number) => void;
}) {
  return (
    <div className="flex items-center">
      {VIDEO_MEGAPIXELS.map((mp) => {
        const { width, height } = videoSize(mp, ...aspect);
        return (
          <span key={mp} title={`${width}×${height}${mp === 0.98 ? "（官方 768p）" : ""}`}>
            <Chip on={megapixels === mp} onClick={() => onChange(mp)}>
              {Math.min(width, height)}p
            </Chip>
          </span>
        );
      })}
    </div>
  );
}

/** Which Turbo LoRA (or none) and the step count; switching resets steps to that speed's default. */
export function VideoStepRows({
  speed,
  steps,
  onChange,
}: {
  speed: VideoSpeed;
  steps: number;
  onChange: (patch: { speed?: VideoSpeed; steps?: number }) => void;
}) {
  const cur = VIDEO_SPEEDS[speed];
  return (
    <>
      <label>加速</label>
      <div className="flex flex-wrap items-center gap-1">
        {(Object.keys(VIDEO_SPEEDS) as VideoSpeed[]).map((id) => (
          <Chip key={id} on={speed === id} onClick={() => onChange({ speed: id, steps: VIDEO_SPEEDS[id].steps })}>
            {VIDEO_SPEEDS[id].label}
          </Chip>
        ))}
        <span className="ml-2 text-faint">{cur.hint}</span>
      </div>
      {cur.min < cur.max && (
      <>
      <label>Steps</label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={cur.min}
          max={cur.max}
          value={steps}
          onChange={(e) => onChange({ steps: Number(e.target.value) })}
          className="w-48 accent-accent-strong"
        />
        <span className="tabular-nums text-fg">{steps}</span>
        <span className="text-faint">建議 {cur.steps}</span>
      </div>
      </>
      )}
    </>
  );
}
