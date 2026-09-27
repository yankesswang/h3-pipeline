"use client";

import { useState } from "react";
import { Layers, Plus, Save, X } from "lucide-react";
import { api, loraPreviewUrl } from "@/lib/client/api";
import type { LoraInfo, LoraUse } from "@/lib/shared/types";

/** Stack LoRAs with a strength each; save and load stacks as named combos. */
export function LoraPicker({ value, onChange }: { value: LoraUse[]; onChange: (l: LoraUse[]) => void }) {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<LoraInfo[]>();
  const [combos, setCombos] = useState<{ name: string; loras: LoraUse[] }[]>();

  async function openPicker() {
    setOpen((o) => !o);
    const [l, s] = await Promise.all([api.loras(), api.settings()]);
    setAvailable(l.loras);
    setCombos(s.loraCombos);
  }

  async function saveCombo() {
    const name = prompt("組合名稱");
    if (!name?.trim()) return;
    const s = await api.settings();
    const next = [...s.loraCombos.filter((c) => c.name !== name.trim()), { name: name.trim(), loras: value }];
    await api.saveSettings({ loraCombos: next });
    setCombos(next);
  }

  const used = new Set(value.map((v) => v.name));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {value.map((l, i) => (
          <div key={l.name} className="flex items-center gap-2 rounded-lg border border-line bg-raised py-1 pr-1 pl-2">
            <span className="max-w-44 truncate font-mono text-[11px] text-fg" title={l.name}>
              {l.name.replace(/\.safetensors$/, "")}
            </span>
            <input
              type="range"
              min={-1}
              max={2}
              step={0.05}
              value={l.strength}
              onChange={(e) => onChange(value.map((v, j) => (j === i ? { ...v, strength: Number(e.target.value) } : v)))}
              className="w-24 accent-accent-strong"
            />
            <span className="w-9 text-right text-[11px] text-fg tabular-nums">{l.strength.toFixed(2)}</span>
            <button onClick={() => onChange(value.filter((_, j) => j !== i))} className="grid size-5 place-items-center rounded text-muted hover:bg-bad/20 hover:text-bad">
              <X className="size-3" />
            </button>
          </div>
        ))}
        <button onClick={openPicker} className="flex items-center gap-1 rounded-lg border border-dashed border-line px-2.5 py-1 text-xs text-muted hover:border-muted hover:text-fg">
          <Plus className="size-3.5" /> LoRA
        </button>
        {value.length > 0 && (
          <button onClick={saveCombo} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-faint hover:text-fg">
            <Save className="size-3.5" /> 存成組合
          </button>
        )}
      </div>

      {open && (
        <div className="rounded-xl border border-line bg-raised p-3">
          {combos && combos.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-line pb-3">
              <span className="text-xs text-faint">組合：</span>
              {combos.map((c) => (
                <button
                  key={c.name}
                  onClick={() => {
                    onChange(c.loras);
                    setOpen(false);
                  }}
                  className="rounded-md bg-panel px-2 py-1 text-xs text-muted hover:text-fg"
                  title={c.loras.map((l) => `${l.name} ×${l.strength}`).join("\n")}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {!available && <p className="text-xs text-faint">讀取中…</p>}
          {available?.length === 0 && (
            <p className="text-xs text-faint">
              ComfyUI 裡還沒有 LoRA。到左側「LoRA」頁看放檔案的資料夾。
            </p>
          )}
          <div className="grid max-h-60 grid-cols-2 gap-1.5 overflow-y-auto lg:grid-cols-3">
            {available
              ?.filter((l) => !used.has(l.name))
              .map((l) => (
                <button
                  key={l.name}
                  onClick={() => {
                    onChange([...value, { name: l.name, strength: l.defaultStrength }]);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2 rounded-lg p-1.5 text-left hover:bg-panel"
                >
                  {l.hasPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={loraPreviewUrl(l.name)} alt="" className="size-10 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="grid size-10 shrink-0 place-items-center rounded bg-panel text-faint">
                      <Layers className="size-4" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[11px]">{l.name.replace(/\.safetensors$/, "")}</span>
                    {l.note && <span className="block truncate text-[10px] text-faint">{l.note}</span>}
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
