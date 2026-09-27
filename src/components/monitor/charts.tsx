"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

// Small hand-rolled SVG charts for the monitor: a part-to-whole bar and a
// 5-minute time chart with a crosshair. Colors come from CSS variables set on
// the page (series slots validated for the dark surface); text stays in ink tokens.

export interface Segment {
  id: string;
  label: string;
  value: number;
  color: string;
}

/** A horizontal part-to-whole bar: segments, then the unused remainder as track. */
export function StackedBar({ segments, total, format }: { segments: Segment[]; total: number; format: (v: number) => string }) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = segments.filter((s) => s.value > 0.5);
  const free = Math.max(0, total - shown.reduce((a, s) => a + s.value, 0));
  const hovered = shown.find((s) => s.id === hover);
  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex h-5 w-full gap-[2px] overflow-hidden rounded-md" onPointerLeave={() => setHover(null)}>
        {shown.map((s) => (
          <div
            key={s.id}
            onPointerEnter={() => setHover(s.id)}
            className="h-full first:rounded-l-md transition-[filter]"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color, filter: hover === s.id ? "brightness(1.25)" : undefined }}
          />
        ))}
        {free > 0 && <div className="h-full flex-1 rounded-r-md bg-line/70" />}
        {hovered && (
          <div className="pointer-events-none absolute top-0 right-0 rounded bg-black/80 px-2 text-xs leading-5 text-fg">
            {hovered.label} {format(hovered.value)}（{((hovered.value / total) * 100).toFixed(0)}%）
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {shown.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5 text-muted" onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(null)}>
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
            <span className="text-fg tabular-nums">{format(s.value)}</span>
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-muted">
          <span className="size-2.5 rounded-sm bg-line" />
          可用 <span className="text-fg tabular-nums">{format(free)}</span>
        </span>
      </div>
    </div>
  );
}

export interface TimeSeries<T> {
  id: string;
  label: string;
  color: string;
  get: (d: T) => number | null;
}

const WINDOW = 5 * 60_000;

/**
 * Values over the last 5 minutes. `stacked` draws the series as stacked areas
 * (parts of a whole, like VRAM by process); otherwise each is a 2px line.
 */
export function TimeChart<T extends { t: number }>({
  data,
  series,
  max,
  stacked = false,
  format,
  ticks,
  height = 150,
  legend = true,
}: {
  data: T[];
  series: TimeSeries<T>[];
  max: number;
  stacked?: boolean;
  format: (v: number) => string;
  ticks: number[];
  height?: number;
  /** Off when a bar right above already names the series in the same colors. */
  legend?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 44, r: 8, t: 8, b: 22 };
  const w = Math.max(100, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const now = data.length ? data[data.length - 1].t : 0;
  const x = (t: number) => pad.l + w - ((now - t) / WINDOW) * w;
  const y = (v: number) => pad.t + h - (Math.min(v, max) / max) * h;

  // Stacked: each series sits on the sum of the ones before it.
  const layers = useMemo(() => {
    const base = data.map(() => 0);
    return series.map((s) => {
      const lo = [...base];
      const hi = data.map((d, i) => {
        const v = s.get(d) ?? 0;
        base[i] = stacked ? base[i] + v : v;
        return base[i];
      });
      return { s, lo: stacked ? lo : null, hi };
    });
  }, [data, series, stacked]);

  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(data[i].t).toFixed(1)},${y(v).toFixed(1)}`).join("");

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!data.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 0;
    for (let i = 0; i < data.length; i++) if (Math.abs(x(data[i].t) - px) < Math.abs(x(data[best].t) - px)) best = i;
    setHoverIdx(best);
  }

  const hd = hoverIdx !== null ? data[hoverIdx] : undefined;
  const minutes = [5, 4, 3, 2, 1, 0];

  return (
    <div ref={box} className="relative w-full select-none">
      {legend && series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {series.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5">
              <span className={stacked ? "size-2.5 rounded-sm" : "h-0.5 w-3 rounded"} style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHoverIdx(null)} className="block">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={pad.l + w} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-faint text-[10px] tabular-nums">
              {format(v)}
            </text>
          </g>
        ))}
        {minutes.map((m) => (
          <text key={m} x={pad.l + w - (m / 5) * w} y={height - 6} textAnchor={m === 0 ? "end" : m === 5 ? "start" : "middle"} className="fill-faint text-[10px]">
            {m === 0 ? "現在" : `${m} 分前`}
          </text>
        ))}
        {data.length > 1 &&
          layers.map(({ s, lo, hi }) =>
            lo ? (
              <g key={s.id}>
                <path
                  d={`${path(hi)}L${x(data[data.length - 1].t)},${y(lo[lo.length - 1])}${lo
                    .map((v, i) => [i, v] as const)
                    .reverse()
                    .map(([i, v]) => `L${x(data[i].t).toFixed(1)},${y(v).toFixed(1)}`)
                    .join("")}Z`}
                  fill={s.color}
                  fillOpacity={0.45}
                />
                <path d={path(hi)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
              </g>
            ) : (
              <path key={s.id} d={path(hi)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ),
          )}
        {hd && (
          <g>
            <line x1={x(hd.t)} x2={x(hd.t)} y1={pad.t} y2={pad.t + h} stroke="var(--color-muted)" strokeWidth={1} />
            {layers.map(({ s, hi }) => (
              <circle key={s.id} cx={x(hd.t)} cy={y(hi[hoverIdx!])} r={4} fill={s.color} stroke="var(--color-panel)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hd && (
        <div
          className="pointer-events-none absolute top-8 z-10 min-w-36 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(x(hd.t) + 12, width - 170) }}
        >
          <div className="mb-1 text-faint">{new Date(hd.t).toLocaleTimeString("zh-TW")}</div>
          {series.map((s) => {
            const v = s.get(hd);
            return (
              <div key={s.id} className="flex items-center gap-2">
                <span className="size-2 rounded-sm" style={{ background: s.color }} />
                <span className="text-muted">{s.label}</span>
                <span className="ml-auto pl-3 text-fg tabular-nums">{v === null ? "—" : format(v)}</span>
              </div>
            );
          })}
          {stacked && (
            <div className="mt-1 flex border-t border-line pt-1 text-muted">
              合計 <span className="ml-auto text-fg tabular-nums">{format(series.reduce((a, s) => a + (s.get(hd) ?? 0), 0))}</span>
            </div>
          )}
        </div>
      )}
      {data.length < 2 && <p className="absolute inset-0 grid place-items-center text-xs text-faint">收集資料中…</p>}
    </div>
  );
}
