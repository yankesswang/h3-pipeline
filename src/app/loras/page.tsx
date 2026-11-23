"use client";

import { useEffect, useState } from "react";
import { FolderOpen, Layers, RefreshCw } from "lucide-react";
import { api, loraPreviewUrl } from "@/lib/client/api";
import type { LoraInfo } from "@/lib/shared/types";
import { Button, inputCls } from "@/components/ui";

/** The LoRAs ComfyUI can see, with notes (trigger words) and a default strength for each. */
export default function LorasPage() {
  const [data, setData] = useState<{ loras: LoraInfo[]; folders: string[]; error?: string }>();
  const load = () => api.loras().then(setData);

  useEffect(() => {
    api.loras().then(setData);
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 md:p-8">
        <header className="flex items-center gap-3">
          <Layers className="size-5 text-accent" />
          <h1 className="text-lg font-medium">LoRA</h1>
          <Button variant="ghost" className="ml-auto" onClick={load}>
            <RefreshCw className="size-4" /> 重新讀取
          </Button>
        </header>
        <p className="-mt-2 text-xs leading-relaxed text-muted">
          把 LoRA 檔（.safetensors）放進下面的資料夾，再按「重新讀取」。同名的 .png / .jpg / .preview.png 會當成預覽圖。
          在這裡寫下觸發詞和預設強度，之後在「創作」頁的進階參數裡就能疊加使用。
        </p>
        {data?.folders.map((f) => (
          <code key={f} className="flex items-center gap-2 rounded-lg bg-raised px-3 py-2 text-xs text-muted">
            <FolderOpen className="size-3.5 shrink-0" /> {f}
          </code>
        ))}
        {data?.error && <p className="text-sm text-bad">{data.error}</p>}
        {data && data.loras.length === 0 && (
          <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-faint">
            還沒有 LoRA。Qwen-Image 用的 LoRA 可以在 HuggingFace 或 Civitai 搜尋「Qwen-Image LoRA」。
          </div>
        )}
        <div className="flex flex-col gap-2">
          {data?.loras.map((l) => (
            <LoraRow key={l.name} lora={l} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LoraRow({ lora }: { lora: LoraInfo }) {
  const [note, setNote] = useState(lora.note);
  const [strength, setStrength] = useState(lora.defaultStrength);
  const [saved, setSaved] = useState(false);
  const [stored, setStored] = useState({ note: lora.note, strength: lora.defaultStrength });
  const dirty = note !== stored.note || strength !== stored.strength;

  async function save() {
    await api.saveLoraMeta(lora.name, note, strength);
    setStored({ note, strength });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel p-3 md:flex-nowrap md:gap-4">
      {lora.hasPreview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={loraPreviewUrl(lora.name)} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="grid size-16 shrink-0 place-items-center rounded-lg bg-raised text-faint">
          <Layers className="size-5" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">
        <span className="truncate font-mono text-xs">{lora.name}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="觸發詞或備註" className={`${inputCls} !py-1 text-xs`} />
      </div>
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted md:w-40 md:flex-none">
        <span className="flex justify-between">
          預設強度 <span className="text-fg tabular-nums">{strength.toFixed(2)}</span>
        </span>
        <input type="range" min={-1} max={2} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="accent-accent-strong" />
      </label>
      <Button variant={dirty ? "primary" : "ghost"} disabled={!dirty} onClick={save} className="w-16 text-xs">
        {saved ? "已存" : "儲存"}
      </Button>
    </div>
  );
}
