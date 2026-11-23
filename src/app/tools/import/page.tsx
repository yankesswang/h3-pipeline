"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, FileUp, Loader2 } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import type { CustomField, CustomTool, FieldCandidate, FieldKind } from "@/lib/shared/types";
import { Button, Select, inputCls } from "@/components/ui";

type Analysis = Awaited<ReturnType<typeof api.analyzeWorkflow>>;

const KIND_LABELS: Record<FieldKind, string> = {
  prompt: "Prompt（可擴寫）",
  text: "文字",
  int: "整數",
  float: "小數",
  seed: "Seed",
  bool: "開關",
  combo: "選單",
  image: "圖片",
};

/** Paste a workflow, pick the fields to expose, save it as a tool. `?id=` edits an existing tool. */
export default function ImportToolPage() {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string>();
  const [raw, setRaw] = useState("");
  const [analysis, setAnalysis] = useState<Analysis>();
  const [picked, setPicked] = useState<Record<string, { on: boolean; label: string; kind: FieldKind }>>({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [outputNode, setOutputNode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function analyze(workflow: unknown, existing?: CustomTool) {
    setError(undefined);
    setBusy(true);
    try {
      const a = await api.analyzeWorkflow(workflow);
      setAnalysis(a);
      const prev = new Map(existing?.fields.map((f) => [f.key, f]));
      setPicked(
        Object.fromEntries(
          a.candidates.map((c) => {
            const e = prev.get(c.key);
            return [c.key, { on: existing ? !!e : c.suggested, label: e?.label ?? c.label, kind: e?.kind ?? c.kind }];
          }),
        ),
      );
      setOutputNode(existing?.outputNode ?? a.outputs[0]?.id ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAnalysis(undefined);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) return;
    api.tool(id).then((t) => {
      setEditingId(t.id);
      setName(t.name);
      setDescription(t.description);
      setRaw(JSON.stringify(t.workflow, null, 2));
      void analyze(t.workflow, t);
    });
  }, []);

  const byNode = useMemo(() => {
    const m = new Map<string, FieldCandidate[]>();
    for (const c of analysis?.candidates ?? []) m.set(c.node, [...(m.get(c.node) ?? []), c]);
    return [...m.entries()];
  }, [analysis]);

  const count = Object.values(picked).filter((p) => p.on).length;

  async function save() {
    if (!analysis) return;
    const fields: CustomField[] = analysis.candidates
      .filter((c) => picked[c.key]?.on)
      .map((c) => {
        const p = picked[c.key];
        return { key: c.key, node: c.node, input: c.input, label: p.label || c.label, kind: p.kind, default: c.default, min: c.min, max: c.max, step: c.step, options: c.options };
      });
    setBusy(true);
    setError(undefined);
    try {
      const t = await api.saveTool({ name, description, workflow: analysis.workflow, fields, outputNode }, editingId);
      router.push(`/tools/${t.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 md:p-8">
        <header className="flex items-center gap-3">
          <Link href="/tools" className="text-muted hover:text-fg">
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="text-lg font-medium">{editingId ? "編輯工具" : "匯入 workflow"}</h1>
        </header>

        {!analysis && (
          <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-5">
            <h2 className="font-medium">1. 貼上 API 格式的 workflow</h2>
            <p className="text-xs text-muted">在 ComfyUI 選單選「Workflow → Export (API)」，把得到的 JSON 貼在下面，或直接選檔案。</p>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={12}
              placeholder='{ "3": { "class_type": "KSampler", "inputs": { ... } }, ... }'
              className={`${inputCls} font-mono text-xs`}
            />
            <div className="flex items-center gap-2">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setRaw(await f.text());
                  }}
                />
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-raised">
                  <FileUp className="size-4" /> 選檔案
                </span>
              </label>
              <Button
                variant="primary"
                disabled={!raw.trim() || busy}
                onClick={() => {
                  try {
                    void analyze(JSON.parse(raw));
                  } catch (e) {
                    setError("JSON 格式有誤：" + (e instanceof Error ? e.message : String(e)));
                  }
                }}
              >
                {busy && <Loader2 className="size-4 animate-spin" />} 分析
              </Button>
            </div>
          </section>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-lg bg-bad/10 px-4 py-3 text-sm text-bad">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}

        {analysis && (
          <>
            {analysis.missing.length > 0 && (
              <p className="flex items-start gap-2 rounded-lg bg-bad/10 px-4 py-3 text-sm text-bad">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                你的 ComfyUI 沒有這些節點，需要先安裝對應的 custom node：{analysis.missing.join("、")}
              </p>
            )}

            <section className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-panel p-4 sm:grid-cols-2 md:p-5">
              <label className="flex flex-col gap-1 text-xs text-muted">
                工具名稱
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：Flux 人像" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                輸出圖片的節點
                <Select value={outputNode} onChange={(e) => setOutputNode(e.target.value)}>
                  {analysis.outputs.length === 0 && <option value="">（找不到 SaveImage / PreviewImage）</option>}
                  {analysis.outputs.map((o) => (
                    <option key={o.id} value={o.id}>
                      #{o.id} {o.title}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">
                說明（選填）
                <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
              </label>
            </section>

            <section className="rounded-xl border border-line bg-panel p-5">
              <div className="mb-3 flex items-baseline gap-2">
                <h2 className="font-medium">2. 勾選要露出的欄位</h2>
                <span className="text-xs text-faint">已選 {count} 個 · 沒勾的欄位會固定用 workflow 裡的值</span>
              </div>
              <div className="flex flex-col gap-4">
                {byNode.map(([node, cs]) => (
                  <div key={node}>
                    <h3 className="mb-1 text-xs text-faint">
                      #{node} {cs[0].nodeTitle}
                      {cs[0].nodeTitle !== cs[0].classType && <span className="ml-1 text-faint/70">（{cs[0].classType}）</span>}
                    </h3>
                    <div className="flex flex-col overflow-x-auto">
                      {cs.map((c) => {
                        const p = picked[c.key];
                        return (
                          <div key={c.key} className={`grid min-w-[640px] grid-cols-[auto_9rem_1fr_9rem_minmax(0,12rem)] items-center gap-3 rounded-lg px-2 py-1 ${p?.on ? "bg-accent-strong/10" : ""}`}>
                            <input
                              type="checkbox"
                              checked={p?.on ?? false}
                              onChange={(e) => setPicked((s) => ({ ...s, [c.key]: { ...s[c.key], on: e.target.checked } }))}
                              className="size-4 accent-accent-strong"
                            />
                            <span className="truncate font-mono text-xs text-muted">{c.input}</span>
                            <input
                              value={p?.label ?? ""}
                              disabled={!p?.on}
                              onChange={(e) => setPicked((s) => ({ ...s, [c.key]: { ...s[c.key], label: e.target.value } }))}
                              className={`${inputCls} !py-1 text-xs disabled:opacity-40`}
                            />
                            <Select
                              value={p?.kind}
                              disabled={!p?.on}
                              onChange={(e) => setPicked((s) => ({ ...s, [c.key]: { ...s[c.key], kind: e.target.value as FieldKind } }))}
                              className="!py-1 text-xs disabled:opacity-40"
                            >
                              {Object.entries(KIND_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </Select>
                            <span className="truncate text-xs text-faint" title={String(c.default)}>
                              {String(c.default)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={save} disabled={busy || !name.trim() || !outputNode}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                儲存工具
              </Button>
              {!editingId && (
                <Button variant="ghost" onClick={() => setAnalysis(undefined)}>
                  換一個 workflow
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
