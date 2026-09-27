"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Dices, ImagePlus, Loader2, Pencil, Play, Square, Wand2, X } from "lucide-react";
import { api, imageUrl, streamLlm } from "@/lib/client/api";
import { randomSeed } from "@/lib/shared/sizes";
import type { CustomField, CustomTool, ImageRecord } from "@/lib/shared/types";
import { useStudio } from "@/components/studio-provider";
import { Button, IconButton, PresetSelect, Select, inputCls } from "@/components/ui";

/** An imported workflow as a form. */
export default function ToolRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { jobs, recent, presets } = useStudio();
  const [tool, setTool] = useState<CustomTool>();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [randomize, setRandomize] = useState<Record<string, boolean>>({});
  const [count, setCount] = useState(1);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [presetId, setPresetId] = useState("qwen-general");
  const toolId = `custom:${id}` as const;

  useEffect(() => {
    api.tool(id).then(
      async (t) => {
        setTool(t);
        const init = Object.fromEntries(t.fields.map((f) => [f.key, f.kind === "image" ? undefined : f.default]));
        setRandomize(Object.fromEntries(t.fields.filter((f) => f.kind === "seed").map((f) => [f.key, true])));
        // ?reuse=<imageId> fills the form with that image's values.
        // Otherwise pick up where this browser left off.
        try {
          Object.assign(init, JSON.parse(localStorage.getItem(`studio.tool.${t.id}`) ?? "{}"));
        } catch {}
        const reuse = new URLSearchParams(window.location.search).get("reuse");
        if (reuse) {
          const img = await api.image(reuse).catch(() => undefined);
          if (img?.params.toolValues) {
            Object.assign(init, img.params.toolValues);
            setRandomize({});
          }
        }
        setValues(init);
      },
      (e) => setError(e.message),
    );
  }, [id]);

  const results = useMemo(() => recent.filter((r) => r.tool === toolId), [recent, toolId]);
  const active = jobs.filter((j) => j.tool === toolId && (j.status === "queued" || j.status === "running" || j.status === "error"));

  async function run() {
    if (!tool) return;
    setError(undefined);
    const v = { ...values };
    for (const f of tool.fields) if (f.kind === "seed" && randomize[f.key]) v[f.key] = randomSeed();
    const missing = tool.fields.find((f) => f.kind === "image" && !v[f.key]);
    if (missing) return setError(`「${missing.label}」需要選一張圖`);
    const prompt = tool.fields.find((f) => f.kind === "prompt");
    const seed = tool.fields.find((f) => f.kind === "seed");
    setSubmitting(true);
    try {
      await api.generate({
        tool: toolId,
        count,
        params: {
          prompt: prompt ? String(v[prompt.key] ?? "") : tool.name,
          negativePrompt: "",
          width: 0,
          height: 0,
          steps: 0,
          cfg: 0,
          seed: seed ? Number(v[seed.key]) : 0,
          toolValues: v,
        },
      });
      setValues(v);
      try {
        localStorage.setItem(`studio.tool.${tool.id}`, JSON.stringify(v));
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!tool)
    return <div className="grid h-full place-items-center text-faint">{error ?? <Loader2 className="size-5 animate-spin" />}</div>;

  return (
    <div className="flex h-full">
      <div className="flex w-[440px] shrink-0 flex-col border-r border-line bg-panel">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Link href="/tools" className="text-muted hover:text-fg">
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="truncate font-medium">{tool.name}</h1>
          <Link href={`/tools/import?id=${tool.id}`} className="ml-auto" title="編輯欄位">
            <IconButton label="編輯欄位">
              <Pencil className="size-4" />
            </IconButton>
          </Link>
        </header>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {tool.description && <p className="text-xs text-muted">{tool.description}</p>}
          {tool.fields.length === 0 && <p className="text-xs text-faint">這個工具沒有露出任何欄位，按「執行」會照原 workflow 跑。</p>}
          {tool.fields.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={values[f.key]}
              onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
              randomize={randomize[f.key]}
              setRandomize={(r) => setRandomize((s) => ({ ...s, [f.key]: r }))}
              recent={recent}
              presetId={presetId}
            />
          ))}
          {tool.fields.some((f) => f.kind === "prompt") && (
            <label className="flex items-center gap-2 text-xs text-faint">
              擴寫用的範本
              <PresetSelect presets={presets} purpose="generate" value={presetId} onChange={setPresetId} className="flex-1 !py-1 text-xs" />
            </label>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-line p-3">
          {error && <p className="flex-1 text-xs text-bad">{error}</p>}
          <div className="ml-auto flex items-center rounded-lg border border-line text-xs">
            <button className="px-2 py-1 text-muted hover:text-fg" onClick={() => setCount((c) => Math.max(1, c - 1))}>
              −
            </button>
            <span className="w-8 text-center tabular-nums">×{count}</span>
            <button className="px-2 py-1 text-muted hover:text-fg" onClick={() => setCount((c) => Math.min(8, c + 1))}>
              +
            </button>
          </div>
          <Button variant="primary" onClick={run} disabled={submitting} className="px-5">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} 執行
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {active.map((j) => (
            <div key={j.id} className={`grid aspect-square place-items-center rounded-xl border border-line ${j.status === "running" ? "shimmer" : "bg-panel"}`}>
              <div className="flex flex-col items-center gap-2 p-4 text-center text-xs">
                {j.status === "error" ? (
                  <span className="text-bad">{j.error}</span>
                ) : (
                  <>
                    <Loader2 className="size-5 animate-spin text-accent" />
                    <span>{j.status === "queued" ? "排隊中" : `${j.stage ?? "處理中"} ${Math.round(j.progress * 100)}%`}</span>
                    <button onClick={() => api.cancelJob(j.id)} className="text-muted hover:text-fg">
                      取消
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {results.map((img) => (
            <ResultCard key={img.id} img={img} onReuse={() => img.params.toolValues && setValues(img.params.toolValues)} />
          ))}
        </div>
        {results.length === 0 && active.length === 0 && <p className="mt-24 text-center text-faint">結果會出現在這裡，也會存進圖庫。</p>}
      </div>
    </div>
  );
}

function ResultCard({ img, onReuse }: { img: ImageRecord; onReuse: () => void }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-line">
      <a href={imageUrl(img.id)} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl(img.id, 640)} alt="" className="w-full" style={{ aspectRatio: img.width / img.height }} />
      </a>
      <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6 opacity-0 transition group-hover:opacity-100">
        <button onClick={onReuse} className="rounded-md bg-black/60 px-2 py-1 text-xs hover:bg-accent-strong">
          用這組設定
        </button>
        <Link href={`/?edit=${img.id}`} className="rounded-md bg-black/60 px-2 py-1 text-xs hover:bg-accent-strong">
          拿去修改
        </Link>
      </div>
    </div>
  );
}

function FieldInput({
  field: f,
  value,
  onChange,
  randomize,
  setRandomize,
  recent,
  presetId,
}: {
  field: CustomField;
  value: unknown;
  onChange: (v: unknown) => void;
  randomize?: boolean;
  setRandomize: (r: boolean) => void;
  recent: ImageRecord[];
  presetId: string;
}) {
  const label = <span className="text-xs text-muted">{f.label}</span>;
  switch (f.kind) {
    case "prompt":
      return <PromptField label={f.label} value={String(value ?? "")} onChange={onChange} presetId={presetId} />;
    case "text":
      return (
        <label className="flex flex-col gap-1">
          {label}
          <input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={inputCls} />
        </label>
      );
    case "bool":
      return (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-accent-strong" />
          {label}
        </label>
      );
    case "combo":
      return (
        <label className="flex flex-col gap-1">
          {label}
          <Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            {(f.options ?? [String(value)]).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </label>
      );
    case "seed":
      return (
        <label className="flex flex-col gap-1">
          {label}
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={Number(value ?? 0)}
              disabled={randomize}
              onChange={(e) => onChange(Number(e.target.value))}
              className={`${inputCls} font-mono text-xs disabled:opacity-50`}
            />
            <IconButton label="換一個" onClick={() => onChange(randomSeed())}>
              <Dices className="size-4" />
            </IconButton>
            <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
              <input type="checkbox" checked={!!randomize} onChange={(e) => setRandomize(e.target.checked)} className="accent-accent-strong" />
              每次隨機
            </label>
          </div>
        </label>
      );
    case "image":
      return <ImageField label={f.label} value={value as string | undefined} onChange={onChange} recent={recent} />;
    default: {
      const n = Number(value ?? 0);
      const slider = f.min !== undefined && f.max !== undefined && f.max - f.min <= 200;
      return (
        <label className="flex flex-col gap-1">
          <span className="flex justify-between text-xs text-muted">
            {f.label}
            <span className="text-fg tabular-nums">{n}</span>
          </span>
          {slider ? (
            <input
              type="range"
              min={f.min}
              max={f.max}
              step={f.step ?? (f.kind === "int" ? 1 : 0.05)}
              value={n}
              onChange={(e) => onChange(Number(e.target.value))}
              className="accent-accent-strong"
            />
          ) : (
            <input
              type="number"
              min={f.min}
              max={f.max}
              step={f.step ?? (f.kind === "int" ? 1 : 0.05)}
              value={n}
              onChange={(e) => onChange(Number(e.target.value))}
              className={inputCls}
            />
          )}
        </label>
      );
    }
  }
}

function PromptField({ label, value, onChange, presetId }: { label: string; value: string; onChange: (v: string) => void; presetId: string }) {
  const [busy, setBusy] = useState(false);
  const ac = useRef<AbortController | null>(null);
  async function expand() {
    const idea = value.trim();
    if (!idea) return;
    setBusy(true);
    ac.current = new AbortController();
    let out = "";
    try {
      await streamLlm("/api/llm/expand", { presetId, idea }, { onContent: (t) => onChange((out += t).trimStart()) }, ac.current.signal);
    } catch {
      onChange(idea);
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-xs text-muted">
        {label}
        {busy ? (
          <button type="button" onClick={() => ac.current?.abort()} className="flex items-center gap-1 text-muted hover:text-fg">
            <Square className="size-3" /> 停止
          </button>
        ) : (
          <button type="button" onClick={expand} disabled={!value.trim()} className="flex items-center gap-1 text-accent disabled:text-faint">
            <Wand2 className="size-3.5" /> 擴寫
          </button>
        )}
      </span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={5} className={`${inputCls} resize-y leading-relaxed`} />
    </label>
  );
}

function ImageField({
  label,
  value,
  onChange,
  recent,
}: {
  label: string;
  value?: string;
  onChange: (id: string | undefined) => void;
  recent: ImageRecord[];
}) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const [img] = await api.upload([f]);
          onChange(img.id);
          setOpen(false);
        }}
      />
      <div className="flex items-center gap-2">
        {value ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(value, 160)} alt="" className="size-20 rounded-lg border border-line object-cover" />
            <button onClick={() => onChange(undefined)} className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-bad text-white">
              <X className="size-3" />
            </button>
          </div>
        ) : (
          <div className="grid size-20 place-items-center rounded-lg border border-dashed border-line text-faint">
            <ImagePlus className="size-5" />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Button variant="outline" className="!py-1 text-xs" onClick={() => setOpen((o) => !o)}>
            從圖庫選
          </Button>
          <Button variant="ghost" className="!py-1 text-xs" onClick={() => fileRef.current?.click()}>
            上傳
          </Button>
        </div>
      </div>
      {open && (
        <div className="grid max-h-56 grid-cols-5 gap-1.5 overflow-y-auto rounded-lg border border-line bg-raised p-2">
          {recent.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                onChange(r.id);
                setOpen(false);
              }}
              className="aspect-square overflow-hidden rounded-md border border-line hover:border-accent"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(r.id, 160)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
