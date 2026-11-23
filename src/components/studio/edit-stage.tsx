"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { imageUrl } from "@/lib/client/api";
import type { ImageRecord } from "@/lib/shared/types";
import type { Pads } from "./composer-state";

export type Tool = "whole" | "brush" | "erase" | "sam" | "outpaint";
export type SamPoint = [number, number, 0 | 1];

const SNAP = 16;
const MAX_PAD = 2048;

/**
 * The image being edited, with a selection overlay (brush, eraser, click-to-select)
 * or outpaint handles around it. All coordinates handed out are in source pixels.
 */
export function EditStage({
  image,
  tool,
  brushSize,
  mask,
  maskVersion,
  onStroke,
  samPoints,
  onSamClick,
  pads,
  onPads,
  busy,
}: {
  image: ImageRecord;
  tool: Tool;
  /** Brush diameter in screen pixels. */
  brushSize: number;
  mask: HTMLCanvasElement;
  /** Bumped by the parent whenever the mask changes outside this component. */
  maskVersion: number;
  onStroke: () => void;
  samPoints: SamPoint[];
  onSamClick: (p: SamPoint) => void;
  pads: Pads;
  onPads: (p: Pads) => void;
  busy: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const outpainting = tool === "outpaint";
  const p = outpainting ? pads : { left: 0, top: 0, right: 0, bottom: 0 };
  const totalW = image.width + p.left + p.right;
  const totalH = image.height + p.top + p.bottom;
  // Fit the whole frame, never enlarging past 100%.
  const scale = box.w && box.h ? Math.min(1, (box.w - 24) / totalW, (box.h - 24) / totalH) : 0;
  const imgW = image.width * scale;
  const imgH = image.height * scale;
  const frameW = totalW * scale;
  const frameH = totalH * scale;

  // Paint the selection, tinted, over the image.
  const redraw = useCallback(() => {
    const c = overlayRef.current;
    if (!c || !scale) return;
    c.width = Math.round(imgW);
    c.height = Math.round(imgH);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (outpainting) return;
    ctx.drawImage(mask, 0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "rgba(139, 92, 246, 0.55)";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "source-over";
  }, [mask, imgW, imgH, scale, outpainting]);

  useEffect(redraw, [redraw, maskVersion]);

  const toSource = (e: React.PointerEvent) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * image.width, y: ((e.clientY - r.top) / r.height) * image.height };
  };

  function paint(from: { x: number; y: number }, to: { x: number; y: number }) {
    const ctx = mask.getContext("2d")!;
    ctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = ctx.fillStyle = "#fff";
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = brushSize / scale;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    redraw();
  }

  const selecting = tool === "brush" || tool === "erase";

  return (
    <div ref={boxRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {scale > 0 && (
        <div
          className={`relative ${outpainting ? "checker rounded-md outline-2 outline-dashed outline-accent/70" : ""}`}
          style={{ width: frameW, height: frameH }}
        >
          <div className="absolute" style={{ left: p.left * scale, top: p.top * scale, width: imgW, height: imgH }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(image.id)} alt="" draggable={false} className="block h-full w-full select-none" />
            <canvas
              ref={overlayRef}
              className={`absolute inset-0 h-full w-full touch-none ${
                selecting ? "cursor-none" : tool === "sam" ? (busy ? "cursor-wait" : "cursor-crosshair") : ""
              }`}
              onPointerDown={(e) => {
                if (tool === "sam") {
                  if (busy) return;
                  const s = toSource(e);
                  onSamClick([Math.round(s.x), Math.round(s.y), e.shiftKey || e.button === 2 ? 0 : 1]);
                  return;
                }
                if (!selecting) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                const s = toSource(e);
                drawing.current = s;
                paint(s, s);
              }}
              onContextMenu={(e) => tool === "sam" && e.preventDefault()}
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
                if (!drawing.current) return;
                const s = toSource(e);
                paint(drawing.current, s);
                drawing.current = s;
              }}
              onPointerUp={() => {
                if (drawing.current) onStroke();
                drawing.current = null;
              }}
              onPointerLeave={() => setCursor(null)}
            />
            {selecting && cursor && (
              <div
                className={`pointer-events-none absolute rounded-full border-2 ${tool === "erase" ? "border-bad" : "border-white"} mix-blend-difference`}
                style={{ width: brushSize, height: brushSize, left: cursor.x - brushSize / 2, top: cursor.y - brushSize / 2 }}
              />
            )}
            {tool === "sam" &&
              samPoints.map(([x, y, pos], i) => (
                <span
                  key={i}
                  className={`pointer-events-none absolute grid size-4 -translate-1/2 place-items-center rounded-full border-2 border-white text-[10px] leading-none font-bold text-white shadow ${
                    pos ? "bg-ok" : "bg-bad"
                  }`}
                  style={{ left: (x / image.width) * imgW, top: (y / image.height) * imgH }}
                >
                  {pos ? "+" : "−"}
                </span>
              ))}
          </div>
          {outpainting && <OutpaintHandles pads={pads} scale={scale} onPads={onPads} />}
          {outpainting && (
            <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-accent tabular-nums">
              {totalW}×{totalH}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Drag the frame's edges and corners to grow the canvas. */
function OutpaintHandles({ pads, scale, onPads }: { pads: Pads; scale: number; onPads: (p: Pads) => void }) {
  const start = useRef<{ x: number; y: number; pads: Pads } | null>(null);

  const handle = (sides: (keyof Pads)[], cls: string, cursor: string) => (
    <div
      key={sides.join()}
      className={`absolute z-10 touch-none ${cls}`}
      style={{ cursor }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY, pads };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const dx = (e.clientX - s.x) / scale;
        const dy = (e.clientY - s.y) / scale;
        const next = { ...s.pads };
        const snap = (v: number) => Math.min(MAX_PAD, Math.max(0, Math.round(v / SNAP) * SNAP));
        for (const side of sides) {
          const d = side === "left" ? -dx : side === "right" ? dx : side === "top" ? -dy : dy;
          next[side] = snap(s.pads[side] + d);
        }
        onPads(next);
      }}
      onPointerUp={() => (start.current = null)}
    >
      <div className="absolute inset-0 m-auto size-3 rounded-sm border-2 border-white bg-accent-strong shadow" />
    </div>
  );

  return (
    <>
      {handle(["left"], "top-0 -left-3 h-full w-6", "ew-resize")}
      {handle(["right"], "top-0 -right-3 h-full w-6", "ew-resize")}
      {handle(["top"], "-top-3 left-0 h-6 w-full", "ns-resize")}
      {handle(["bottom"], "-bottom-3 left-0 h-6 w-full", "ns-resize")}
      {handle(["top", "left"], "-top-3 -left-3 size-6", "nwse-resize")}
      {handle(["top", "right"], "-top-3 -right-3 size-6", "nesw-resize")}
      {handle(["bottom", "left"], "-bottom-3 -left-3 size-6", "nesw-resize")}
      {handle(["bottom", "right"], "-right-3 -bottom-3 size-6", "nwse-resize")}
    </>
  );
}
