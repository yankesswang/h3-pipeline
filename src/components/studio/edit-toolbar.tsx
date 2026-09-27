"use client";

import { Brush, Eraser, Expand, FlipHorizontal2, Image as ImageIcon, Loader2, MousePointerClick, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { NO_PADS, padsForAspect, type Pads } from "./composer-state";
import type { Tool } from "./edit-stage";

const TOOLS: { id: Tool; label: string; icon: typeof Brush; hint: string }[] = [
  { id: "whole", label: "整張", icon: ImageIcon, hint: "指令套用到整張圖" },
  { id: "sam", label: "點選物件", icon: MousePointerClick, hint: "點一下選物件，Shift+點一下排除" },
  { id: "brush", label: "筆刷", icon: Brush, hint: "塗出要修改的範圍" },
  { id: "erase", label: "橡皮擦", icon: Eraser, hint: "擦掉多選的部分" },
  { id: "outpaint", label: "擴圖", icon: Expand, hint: "拖曳邊框，把畫面往外延伸" },
];

const ASPECT_PRESETS = [
  { label: "16:9", r: 16 / 9 },
  { label: "9:16", r: 9 / 16 },
  { label: "4:3", r: 4 / 3 },
  { label: "3:4", r: 3 / 4 },
  { label: "1:1", r: 1 },
];

export function EditToolbar({
  tool,
  setTool,
  brushSize,
  setBrushSize,
  hasMask,
  onInvert,
  onClear,
  samReady,
  samBusy,
  samError,
  onPads,
  width,
  height,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  brushSize: number;
  setBrushSize: (n: number) => void;
  hasMask: boolean;
  onInvert: () => void;
  onClear: () => void;
  samReady: boolean;
  samBusy: boolean;
  samError?: string;
  onPads: (p: Pads) => void;
  width: number;
  height: number;
}) {
  const current = TOOLS.find((t) => t.id === tool)!;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-2 py-1.5 text-xs">
      <div className="flex items-center gap-0.5 rounded-lg bg-raised p-0.5">
        {TOOLS.map((t) => {
          const disabled = t.id === "sam" && !samReady;
          return (
            <button
              key={t.id}
              disabled={disabled}
              title={disabled ? "第一次使用要先下載 SAM 模型（約 180MB），完成後就能用" : t.hint}
              onClick={() => setTool(t.id)}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 transition disabled:cursor-not-allowed disabled:text-faint ${
                tool === t.id ? "bg-accent-strong text-white" : "text-muted hover:text-fg"
              }`}
            >
              <t.icon className="size-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {(tool === "brush" || tool === "erase") && (
        <label className="flex items-center gap-2 text-muted">
          大小
          <input
            type="range"
            min={8}
            max={160}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-28 accent-accent-strong"
          />
        </label>
      )}

      {tool === "outpaint" && (
        <div className="flex items-center gap-1">
          <span className="text-muted">擴展成</span>
          {ASPECT_PRESETS.map((a) => (
            <Small key={a.label} onClick={() => onPads(padsForAspect(width, height, a.r))}>
              {a.label}
            </Small>
          ))}
          <Small
            onClick={() => {
              const s = (n: number) => Math.round((n * 0.25) / 16) * 16;
              onPads({ left: s(width), right: s(width), top: s(height), bottom: s(height) });
            }}
          >
            四周 +25%
          </Small>
          <Small onClick={() => onPads(NO_PADS)}>重設</Small>
        </div>
      )}

      {tool !== "outpaint" && tool !== "whole" && hasMask && (
        <div className="flex items-center gap-1">
          <Small onClick={onInvert}>
            <FlipHorizontal2 className="size-3.5" /> 反選
          </Small>
          <Small onClick={onClear}>
            <Trash2 className="size-3.5" /> 清除
          </Small>
        </div>
      )}

      <span className="ml-auto flex items-center gap-1.5 text-faint">
        {samBusy && <Loader2 className="size-3.5 animate-spin text-accent" />}
        {samError ? <span className="text-bad">{samError}</span> : current.hint}
      </span>
    </div>
  );
}

function Small({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 rounded-md px-2 py-1 text-muted hover:bg-raised hover:text-fg">
      {children}
    </button>
  );
}
