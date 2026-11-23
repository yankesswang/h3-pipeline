"use client";

import { useRef, useState } from "react";
import { ArrowLeft, Copy, Lock, Plus, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { api, imageUrl, streamLlm } from "@/lib/client/api";
import { FAMILY_LABELS, PURPOSE_LABELS, type ModelFamily, type Preset, type PresetPurpose } from "@/lib/shared/types";
import { useStudio } from "@/components/studio-provider";
import { Button, Select, inputCls } from "@/components/ui";

type Draft = Pick<Preset, "name" | "family" | "purpose" | "content">;

export default function PresetsPage() {
  const { presets, reloadPresets } = useStudio();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = presets.find((p) => p.id === selectedId) ?? presets[0];
  // Phones show the list or the editor, not both: the editor once one is picked.
  const [picked, setPicked] = useState(false);
  const pick = (id: string | undefined) => {
    setSelectedId(id);
    setPicked(!!id);
  };

  const create = async () => {
    const p = await api.createPreset({ name: "新範本", family: "qwen-image", purpose: "generate", content: "You are an image prompt writer. Output only the prompt." });
    await reloadPresets();
    pick(p.id);
  };

  return (
    <div className="flex h-full">
      <aside className={`w-full shrink-0 flex-col border-line bg-panel md:flex md:w-72 md:border-r ${picked ? "hidden" : "flex"}`}>
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h1 className="text-base font-medium">Prompt 庫</h1>
          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={create}>
            <Plus className="size-3.5" /> 新增
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto p-2">
          {(Object.keys(PURPOSE_LABELS) as PresetPurpose[]).map((purpose) => (
            <div key={purpose} className="mb-3">
              <h2 className="px-3 py-1 text-[11px] font-medium tracking-wide text-faint">{PURPOSE_LABELS[purpose]}</h2>
          {presets.filter((p) => p.purpose === purpose).map((p) => (
            <button
              key={p.id}
              onClick={() => pick(p.id)}
              className={`mb-1 w-full rounded-lg px-3 py-2 text-left ${p.id === selected?.id ? "bg-raised" : "hover:bg-raised/50"}`}
            >
              <div className="flex items-center gap-1.5">
                {p.builtin && <Lock className="size-3 text-faint" />}
                <span className="truncate">{p.name}</span>
                {p.builtin && p.updatedAt > 0 && <span className="shrink-0 text-[10px] text-accent">已修改</span>}
              </div>
              <div className="mt-0.5 text-xs text-faint">{FAMILY_LABELS[p.family]}</div>
            </button>
          ))}
            </div>
          ))}
        </div>
      </aside>

      {/* Keyed so the draft resets whenever another preset is picked or this one is saved. */}
      {selected && (
        <div className={`min-w-0 flex-1 md:flex ${picked ? "flex" : "hidden"}`}>
          <Editor key={`${selected.id}:${selected.updatedAt}`} preset={selected} onSelect={pick} onBack={() => setPicked(false)} />
        </div>
      )}
    </div>
  );
}

function Editor({ preset, onSelect, onBack }: { preset: Preset; onSelect: (id: string | undefined) => void; onBack: () => void }) {
  const { reloadPresets } = useStudio();
  const [draft, setDraft] = useState<Draft>({ name: preset.name, family: preset.family, purpose: preset.purpose, content: preset.content });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  /** A built-in preset the user has edited: it can be put back to the shipped version. */
  const modified = preset.builtin && preset.updatedAt > 0;
  const dirty =
    draft.name !== preset.name || draft.family !== preset.family || draft.purpose !== preset.purpose || draft.content !== preset.content;

  async function run(fn: () => Promise<Preset | void>) {
    setSaving(true);
    setError(undefined);
    try {
      const p = await fn();
      await reloadPresets();
      if (p) onSelect(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const duplicate = () =>
    run(() => api.createPreset({ name: `${preset.name}（副本）`, family: preset.family, purpose: preset.purpose, content: preset.content }));

  return (
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3 md:p-6">
            <button onClick={onBack} className="flex items-center gap-1.5 self-start text-xs text-muted hover:text-fg md:hidden">
              <ArrowLeft className="size-3.5" /> 所有範本
            </button>
            {preset.builtin && (
              <div className="flex items-center gap-3 rounded-lg border border-line bg-raised/50 px-4 py-2.5 text-xs text-muted">
                <Lock className="size-3.5" />
                {modified ? "這是修改過的內建範本，隨時可以還原成預設內容。" : "內建範本可以直接修改；改過後可隨時還原預設。"}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
                名稱
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className={inputCls}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-muted sm:w-36 sm:flex-none">
                用途
                <Select
                  value={draft.purpose}
                  onChange={(e) => setDraft({ ...draft, purpose: e.target.value as PresetPurpose })}
                >
                  {Object.entries(PURPOSE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex w-full flex-col gap-1 text-xs text-muted sm:w-60">
                適用模型
                <Select
                  value={draft.family}
                  onChange={(e) => setDraft({ ...draft, family: e.target.value as ModelFamily })}
                >
                  {Object.entries(FAMILY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs text-muted">
              System prompt
              <textarea
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                rows={16}
                className={`${inputCls} font-mono text-[13px] leading-relaxed`}
              />
            </label>

            {error && <p className="text-xs text-bad">{error}</p>}

            <div className="flex items-center gap-2">
                <Button variant="primary" disabled={!dirty || saving} onClick={() => run(() => api.updatePreset(preset.id, draft))}>
                  儲存
                </Button>
                <Button variant="ghost" disabled={!dirty} onClick={() => setDraft({ name: preset.name, family: preset.family, purpose: preset.purpose, content: preset.content })}>
                  放棄修改
                </Button>
                <Button variant="ghost" onClick={duplicate}>
                  <Copy className="size-3.5" /> 複製
                </Button>
                {preset.builtin ? (
                  modified && (
                    <Button
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => {
                        if (confirm(`把「${preset.name}」還原成預設內容？你的修改會消失。`)) run(() => api.resetPreset(preset.id));
                      }}
                    >
                      <RotateCcw className="size-3.5" /> 還原預設
                    </Button>
                  )
                ) : (
                  <Button
                    variant="danger"
                    className="ml-auto"
                    onClick={() => {
                      if (confirm(`刪除「${preset.name}」？`)) run(async () => {
                        await api.deletePreset(preset.id);
                        onSelect(undefined);
                      });
                    }}
                  >
                    <Trash2 className="size-3.5" /> 刪除
                  </Button>
                )}
            </div>

            <TryIt preset={preset} dirty={dirty} />
          </div>
        </div>
  );
}

/** Run the saved preset on a sample idea, to see what it produces before using it. */
function TryIt({ preset, dirty }: { preset: Preset; dirty: boolean }) {
  const { recent } = useStudio();
  // Edit presets need something to look at: try them on the newest image.
  const sample = preset.purpose === "edit" ? recent[0] : undefined;
  const [idea, setIdea] = useState(preset.purpose === "edit" ? "把背景換成下雪的京都街道" : "一隻在雨中的台北街頭撐傘的柴犬");
  const [out, setOut] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const ac = useRef<AbortController | null>(null);

  async function run() {
    setOut("");
    setError(undefined);
    setRunning(true);
    ac.current = new AbortController();
    try {
      await streamLlm("/api/llm/expand", { presetId: preset.id, idea, imageIds: sample ? [sample.id] : undefined }, { onContent: (t) => setOut((o) => o + t) }, ac.current.signal);
    } catch (e) {
      if (!ac.current.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-line bg-panel p-4">
      <h2 className="mb-2 font-medium">試跑</h2>
      {dirty && <p className="mb-2 text-xs text-faint">試跑用的是已儲存的版本，先儲存才會套用修改。</p>}
      <div className="flex gap-2">
        {sample && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl(sample.id, 160)} alt="" title="用最新的一張圖試跑" className="size-10 shrink-0 rounded-md object-cover" />
        )}
        <input value={idea} onChange={(e) => setIdea(e.target.value)} className={inputCls} />
        {running ? (
          <Button onClick={() => ac.current?.abort()}>
            <Square className="size-3.5" /> 停止
          </Button>
        ) : (
          <Button variant="primary" onClick={run} disabled={!idea.trim()}>
            <Play className="size-3.5" /> 試跑
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      {out && <p className="mt-3 rounded-lg bg-raised p-3 text-[13px] leading-relaxed whitespace-pre-wrap">{out.trim()}</p>}
    </section>
  );
}
