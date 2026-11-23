"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { IconButton } from "@/components/ui";

const MIN = 1;
const MAX = 32;
const STEP = 1.25;

type View = { s: number; x: number; y: number };
const FIT: View = { s: 1, x: 0, y: 0 };

/**
 * An image that zooms (click, buttons, Ctrl +/-/0, wheel, double-click) and pans by
 * dragging once zoomed in. Mount with a `key` per image so each starts fitted.
 */
export function ZoomableImage({ src, alt, className = "" }: { src: string; alt?: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>(FIT);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Keep the image covering the frame: no panning past its edges.
  const clamp = useCallback((v: View): View => {
    const b = box.current, i = img.current;
    if (!b || !i) return v;
    const s = Math.min(MAX, Math.max(MIN, v.s));
    const mx = Math.max(0, (i.offsetWidth * s - b.clientWidth) / 2);
    const my = Math.max(0, (i.offsetHeight * s - b.clientHeight) / 2);
    return { s, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
  }, []);

  // Scale by `f` keeping the point (px, py), relative to the frame's centre, still.
  const zoomAt = useCallback(
    (f: number, px = 0, py = 0) =>
      setView((v) => {
        const s = Math.min(MAX, Math.max(MIN, v.s * f));
        const k = s / v.s;
        return clamp({ s, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
      }),
    [clamp],
  );

  const fromCentre = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2] as const;
  };

  // Wheel must be non-passive to stop the page (or browser) from zooming instead.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [px, py] = fromCentre(e.clientX, e.clientY);
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), px, py);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
      if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") zoomAt(STEP);
      else if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") zoomAt(1 / STEP);
      else if (e.key === "0") setView(FIT);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomAt]);

  useEffect(() => {
    const onResize = () => setView((v) => clamp(v));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  const zoomed = view.s > 1;
  const actualSize = () => {
    const image = img.current;
    if (!image?.offsetWidth) return;
    zoomAt(image.naturalWidth / image.offsetWidth / view.s);
  };

  return (
    <div
      ref={box}
      className={`relative flex size-full items-center justify-center overflow-hidden select-none ${
        zoomed ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
      }`}
      style={{ touchAction: "none" }}
      onClick={(e) => {
        if (zoomed || e.target !== img.current) return;
        const [px, py] = fromCentre(e.clientX, e.clientY);
        zoomAt(2, px, py);
      }}
      onDoubleClick={(e) => {
        if (zoomed) return setView(FIT);
        const [px, py] = fromCentre(e.clientX, e.clientY);
        zoomAt(2.5, px, py);
      }}
      onPointerDown={(e) => {
        if (!zoomed || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const previous = drag.current;
        if (!previous || previous.id !== e.pointerId) return;
        const dx = e.clientX - previous.x, dy = e.clientY - previous.y;
        drag.current = { ...previous, x: e.clientX, y: e.clientY };
        setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }));
      }}
      onPointerUp={(e) => {
        if (drag.current?.id !== e.pointerId) return;
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={img}
        src={src}
        alt={alt}
        draggable={false}
        className={`max-h-full max-w-full object-contain ${dragging ? "" : "transition-transform duration-100 ease-out"} ${className}`}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
      />
      <div
        className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-lg border border-white/30 bg-black/85 p-1 text-xs text-white shadow-lg"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <IconButton label="縮小 (Ctrl -)" className="text-white hover:bg-white/20 hover:text-white disabled:text-white/30" onClick={() => zoomAt(1 / STEP)} disabled={view.s <= MIN}>
          <ZoomOut className="size-4" />
        </IconButton>
        <button title="符合視窗 (Ctrl 0)" onClick={() => setView(FIT)} className="min-w-16 rounded-md px-2 py-1 hover:bg-white/20">
          {zoomed ? `${Math.round(view.s * 100)}%` : "符合畫面"}
        </button>
        <IconButton label="放大 (Ctrl +)" className="text-white hover:bg-white/20 hover:text-white disabled:text-white/30" onClick={() => zoomAt(STEP)} disabled={view.s >= MAX}>
          <ZoomIn className="size-4" />
        </IconButton>
        <button title="以圖片原始像素顯示" onClick={actualSize} className="rounded-md px-2 py-1 hover:bg-white/20">原尺寸</button>
      </div>
    </div>
  );
}
