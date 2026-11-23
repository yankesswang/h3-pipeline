"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Dices, ExternalLink, Folder, FolderOpen, FolderUp, Heart, ImagePlus, Images, Loader2, Play, Search, Square, Undo2, Wand2, X, ZoomIn } from "lucide-react";
import { api, imageUrl, streamLlm } from "@/lib/client/api";
import { QUALITIES, randomSeed } from "@/lib/shared/sizes";
import type { FolderListing, ImageRecord, Job, LoraUse, PromptOrigin } from "@/lib/shared/types";
import { LoraPicker } from "@/components/studio/lora-picker";
import { useStudio } from "@/components/studio-provider";
import { useImageDrop } from "@/components/workflow";
import { ZoomableImage } from "@/components/zoomable-image";
import { Button, Chip, IconButton, PresetSelect, inputCls } from "@/components/ui";

// The same edit instruction applied to every image in a folder or a gallery
// selection, like ComfyUI's batch edit workflow. Each image is its own job.

const SIZES = [
  { id: 1024, label: "1MP（快）" },
  { id: 0, label: "原尺寸" },
] as const;

interface Form {
  source: "folder" | "gallery";
  folder: string;
  prompt: string;
  steps: number;
  resolution: number;
  seed: number;
  randomize: boolean;
  loras: LoraUse[];
  saveOn: boolean;
  /** Empty = `<folder>/edited`. */
  saveTo: string;
  /** Edit preset the LLM uses to expand the instruction. */
  presetId: string;
  /** Expand the instruction with the LLM when starting, unless it already was. */
  autoExpand: boolean;
}

// The instruction goes to every image, so the LLM must not tailor it to one.
const BATCH_NOTE =
  "[Batch edit: this instruction is applied to many different images, each one in turn as <image1>. Look at the attached images to see what kind of pictures they are and word the instruction to suit them, but keep it general so it fits every image: do not describe details only one image has. They are not reference images.]";

const DEFAULTS: Form = {
  source: "folder",
  folder: "~/Pictures",
  prompt: "",
  steps: 25,
  resolution: 1024,
  seed: 0,
  randomize: true,
  loras: [],
  saveOn: true,
  saveTo: "",
  presetId: "qwen-edit",
  autoExpand: false,
};

const STORE = "studio.batch";

export default function BatchPage() {
  const { jobs } = useStudio();
  const [form, setForm] = useState<Form>(DEFAULTS);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const [listing, setListing] = useState<FolderListing>();
  const [folderError, setFolderError] = useState<string>();
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [shownBatch, setShownBatch] = useState<string>();
  const { presets, status } = useStudio();
  const [expanding, setExpanding] = useState(false);
  /** Set after an LLM expansion; cleared when the instruction is edited by hand. */
  const [origin, setOrigin] = useState<PromptOrigin>();
  const abortRef = useRef<AbortController | null>(null);
  const editPresets = presets.filter((p) => p.purpose === "edit");
  const preset = editPresets.find((p) => p.id === form.presetId) ?? editPresets[0];
  const willExpand = form.autoExpand && !origin && !!form.prompt.trim() && !!preset;

  // Pick up where this browser left off.
  useEffect(() => {
    let saved: Partial<Form> = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    } catch {}
    const next = { ...DEFAULTS, ...saved };
    api.folder(next.folder).then(
      (l) => {
        setListing(l);
        setForm({ ...next, folder: l.path });
      },
      (e) => {
        setForm(next);
        setFolderError(e instanceof Error ? e.message : String(e));
      },
    );
  }, []);

  async function browse(path: string) {
    try {
      const l = await api.folder(path);
      setListing(l);
      setFolderError(undefined);
      set({ folder: l.path });
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : String(e));
    }
  }

  const defaultSaveTo = listing ? `${listing.path}/edited` : "";
  const count = form.source === "folder" ? (listing?.images.length ?? 0) : picked.length;

  /** The instruction written out by the LLM. Returns it, or nothing when it failed or was stopped. */
  async function expand() {
    const idea = form.prompt.trim();
    if (!idea || !preset) return;
    setError(undefined);
    setExpanding(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let out = "";
    set({ prompt: "" });
    try {
      await streamLlm(
        "/api/llm/expand",
        {
          presetId: preset.id,
          idea: `${idea}\n\n${BATCH_NOTE}`,
          batch: form.source === "folder" ? { folder: listing?.path ?? form.folder } : { imageIds: picked },
        },
        { onContent: (t) => set({ prompt: (out += t).trimStart() }) },
        ac.signal,
      );
      const prompt = out.trim();
      if (!prompt) throw new Error("LLM 沒有回傳內容");
      const o: PromptOrigin = { idea, presetId: preset.id, presetName: preset.name, systemPrompt: preset.content, llmModel: status?.llmModel };
      set({ prompt });
      setOrigin(o);
      return { prompt, origin: o };
    } catch (e) {
      set({ prompt: idea });
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExpanding(false);
      abortRef.current = null;
    }
  }

  async function run() {
    setError(undefined);
    if (!form.prompt.trim()) return setError("請輸入修圖指令");
    if (!count) return setError(form.source === "folder" ? "這個資料夾沒有圖片" : "請選擇要修改的圖片");
    // Check the save folder before spending time on the LLM.
    if (form.saveOn && !form.saveTo.trim() && form.source !== "folder") return setError("請填另存的資料夾");
    let prompt = form.prompt.trim();
    let from = origin;
    if (willExpand) {
      const r = await expand();
      if (!r) return;
      prompt = r.prompt;
      from = r.origin;
    }
    await start(prompt, from);
  }

  async function start(prompt: string, from?: PromptOrigin) {
    const seed = form.randomize ? randomSeed() : form.seed;
    const saveTo = form.saveOn ? form.saveTo.trim() || (form.source === "folder" ? defaultSaveTo : "") : "";
    if (form.saveOn && !saveTo) return setError("請填另存的資料夾");
    setSubmitting(true);
    try {
      const created = await api.startBatch({
        folder: form.source === "folder" ? form.folder : undefined,
        imageIds: form.source === "gallery" ? picked : undefined,
        saveTo: saveTo || undefined,
        params: {
          prompt,
          negativePrompt: "",
          width: 0,
          height: 0,
          steps: form.steps,
          cfg: 1,
          seed,
          resolution: form.resolution,
          loras: form.loras.length ? form.loras : undefined,
        },
        origin: from,
      });
      setShownBatch(created[0]?.params.batch?.id);
      set({ seed });
      try {
        localStorage.setItem(STORE, JSON.stringify({ ...form, prompt, seed }));
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // Batches still in the job list, newest first.
  const batches = useMemo(() => {
    const byId = new Map<string, Job[]>();
    for (const j of jobs) {
      const b = j.params.batch;
      if (b) byId.set(b.id, [...(byId.get(b.id) ?? []), j]);
    }
    return [...byId.entries()]
      .map(([id, js]) => ({ id, jobs: js.sort((a, b) => a.params.batch!.index - b.params.batch!.index) }))
      .sort((a, b) => b.jobs[0].createdAt - a.jobs[0].createdAt);
  }, [jobs]);
  const current = batches.find((b) => b.id === shownBatch) ?? batches[0];

  return (
    <div className="flex h-full flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      <div className="flex w-full shrink-0 flex-col border-b border-line bg-panel md:w-[440px] md:border-r md:border-b-0">
        <header className="border-b border-line px-4 py-3">
          <h1 className="font-medium">批次修圖</h1>
          <p className="text-xs text-muted">同一個指令套用到每一張圖，結果存進圖庫。</p>
        </header>
        <div className="flex flex-1 flex-col gap-5 p-3 md:overflow-y-auto md:p-4">
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
              <span className="mr-2 text-xs text-muted">圖片來源</span>
              <Chip on={form.source === "folder"} onClick={() => set({ source: "folder" })}>
                資料夾
              </Chip>
              <Chip on={form.source === "gallery"} onClick={() => set({ source: "gallery" })}>
                圖庫 / 上傳
              </Chip>
            </div>
            {form.source === "folder" ? (
              <FolderBrowser folder={form.folder} setFolder={(folder) => set({ folder })} listing={listing} error={folderError} browse={browse} />
            ) : (
              <GalleryPicker picked={picked} setPicked={setPicked} />
            )}
          </section>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">修圖指令（每張圖都是 &lt;image1&gt;）</span>
            {origin?.idea && !expanding && (
              <div className="flex items-center gap-2 rounded-lg bg-raised/60 px-3 py-1.5 text-xs text-muted">
                <span className="shrink-0 text-faint">原始想法</span>
                <span className="truncate">{origin.idea}</span>
                <button
                  type="button"
                  className="ml-auto flex shrink-0 items-center gap-1 hover:text-fg"
                  onClick={() => {
                    set({ prompt: origin.idea! });
                    setOrigin(undefined);
                  }}
                >
                  <Undo2 className="size-3" /> 還原
                </button>
              </div>
            )}
            <textarea
              value={form.prompt}
              onChange={(e) => {
                set({ prompt: e.target.value });
                if (!e.target.value.trim()) setOrigin(undefined);
              }}
              rows={4}
              placeholder="用任何語言描述要怎麼改，例如「背景換成陽光海灘，人物不變」，可以按「擴寫」讓 LLM 寫成精確的英文指令；或直接寫英文：Replace the background with a sunny beach, keep the person unchanged"
              className={`${inputCls} resize-y leading-relaxed`}
            />
          </label>
          <div className="-mt-3 flex flex-wrap items-center gap-1">
            {expanding ? (
              <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={() => abortRef.current?.abort()}>
                <Square className="size-3.5" /> 停止
              </Button>
            ) : (
              <Button
                variant="outline"
                className="!px-2 !py-1 text-xs text-accent"
                onClick={() => expand()}
                disabled={!form.prompt.trim() || !preset}
                title="用修圖範本把描述寫成精確的英文修圖指令（寫成通用版，適用每一張圖）"
              >
                <Wand2 className="size-3.5" /> 擴寫
              </Button>
            )}
            <PresetSelect
              presets={presets}
              purpose="edit"
              value={preset?.id ?? ""}
              onChange={(presetId) => set({ presetId })}
              className="!py-1 text-xs"
            />
            <label
              className={`ml-1 flex cursor-pointer items-center gap-1.5 text-xs ${form.autoExpand ? "text-accent" : "text-muted"}`}
              title="開啟後，按「開始」會先用 LLM 擴寫指令再開始批次；已擴寫過的指令不會再擴寫"
            >
              <input
                type="checkbox"
                checked={form.autoExpand}
                onChange={(e) => set({ autoExpand: e.target.checked })}
                className="accent-accent-strong"
              />
              自動擴寫
            </label>
            <span className="ml-auto truncate text-[11px] text-faint">{status?.llmModel}</span>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
              <span className="w-12 text-xs text-muted">品質</span>
              {QUALITIES.map((q) => (
                <Chip key={q.id} on={form.steps === q.steps} onClick={() => set({ steps: q.steps })}>
                  {q.label}
                </Chip>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="w-12 text-xs text-muted">尺寸</span>
              {SIZES.map((s) => (
                <Chip key={s.id} on={form.resolution === s.id} onClick={() => set({ resolution: s.id })}>
                  {s.label}
                </Chip>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-xs text-muted">Seed</span>
              <input
                type="number"
                value={form.seed}
                disabled={form.randomize}
                onChange={(e) => set({ seed: Number(e.target.value) })}
                className={`${inputCls} !py-1 font-mono text-xs disabled:opacity-50`}
              />
              <IconButton label="換一個" onClick={() => set({ seed: randomSeed() })}>
                <Dices className="size-4" />
              </IconButton>
              <label className="flex shrink-0 items-center gap-1 text-xs text-muted" title="整批共用同一個 seed，每次開始換一個">
                <input type="checkbox" checked={form.randomize} onChange={(e) => set({ randomize: e.target.checked })} className="accent-accent-strong" />
                每批隨機
              </label>
            </div>
          </div>

          <LoraPicker value={form.loras} onChange={(loras) => set({ loras })} />

          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={form.saveOn} onChange={(e) => set({ saveOn: e.target.checked })} className="accent-accent-strong" />
              另存一份到資料夾（照原檔名，photo.jpg → photo.png）
            </label>
            {form.saveOn && (
              <input
                value={form.saveTo}
                onChange={(e) => set({ saveTo: e.target.value })}
                placeholder={form.source === "folder" ? defaultSaveTo : "~/Pictures/edited"}
                className={`${inputCls} font-mono text-xs`}
              />
            )}
          </div>
        </div>
        <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-line bg-panel p-3">
          {error && <p className="flex-1 text-xs text-bad">{error}</p>}
          <Button variant="primary" onClick={run} disabled={submitting || expanding || !count} className="ml-auto px-5">
            {submitting || expanding ? <Loader2 className="size-4 animate-spin" /> : willExpand ? <Wand2 className="size-4" /> : <Play className="size-4" />}
            {expanding
              ? "擴寫中…"
              : submitting && form.source === "folder"
                ? "讀取圖片中…"
                : `${willExpand ? "擴寫並" : ""}開始（${count} 張）`}
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 shrink-0 flex-col max-md:min-h-[50vh] md:flex-1 md:shrink">
        {batches.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 md:px-6">
            {batches.map((b) => (
              <Chip key={b.id} on={b.id === current?.id} onClick={() => setShownBatch(b.id)}>
                {new Date(b.jobs[0].createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {b.jobs.length} 張
              </Chip>
            ))}
          </div>
        )}
        {current ? (
          <BatchView jobs={current.jobs} onCancel={() => api.cancelBatch(current.id)} />
        ) : (
          <p className="mt-12 px-4 text-center text-faint md:mt-24">選好圖片、寫好指令，按「開始」。進度會出現在這裡。</p>
        )}
      </div>
    </div>
  );
}

function FolderBrowser({
  folder,
  setFolder,
  listing,
  error,
  browse,
}: {
  folder: string;
  setFolder: (f: string) => void;
  listing?: FolderListing;
  error?: string;
  browse: (path: string) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string>();
  async function pick() {
    setPicking(true);
    setPickError(undefined);
    try {
      const { path } = await api.pickFolder(listing?.path ?? folder);
      if (path) await browse(path);
    } catch (e) {
      setPickError(e instanceof Error ? e.message : String(e));
    } finally {
      setPicking(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" onClick={pick} disabled={picking} className="self-start">
        {picking ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
        {picking ? "請在跳出的視窗選擇資料夾…" : "選擇資料夾…"}
      </Button>
      {pickError && <p className="text-xs text-bad">{pickError}</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void browse(folder);
        }}
      >
        <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="~/Pictures/trip" className={`${inputCls} font-mono text-xs`} />
        <Button type="submit">開啟</Button>
      </form>
      {error && <p className="text-xs text-bad">{error}</p>}
      {listing && (
        <div className="rounded-lg border border-line bg-raised">
          <div className="flex max-h-40 flex-col overflow-y-auto p-1 text-xs">
            {listing.parent && (
              <button onClick={() => browse(listing.parent!)} className="flex items-center gap-2 rounded px-2 py-1 text-muted hover:bg-panel hover:text-fg">
                <FolderUp className="size-3.5" /> 上一層
              </button>
            )}
            {listing.dirs.map((d) => (
              <button
                key={d}
                onClick={() => browse(`${listing.path}/${d}`)}
                className="flex items-center gap-2 truncate rounded px-2 py-1 text-left text-fg hover:bg-panel"
              >
                <Folder className="size-3.5 shrink-0 text-accent" /> {d}
              </button>
            ))}
            {!listing.parent && !listing.dirs.length && <span className="px-2 py-1 text-faint">沒有子資料夾</span>}
          </div>
          <p className="border-t border-line px-3 py-2 text-xs text-muted" title={listing.images.join("\n")}>
            {listing.images.length ? (
              <>
                <span className="text-fg">{listing.images.length} 張圖片</span>，依檔名順序：{listing.images.slice(0, 3).join("、")}
                {listing.images.length > 3 && "…"}
              </>
            ) : (
              "這裡沒有 PNG / JPG / WEBP 圖片"
            )}
          </p>
        </div>
      )}
    </div>
  );
}

const PICK_PAGE = 60;
/** The server's limit on one batch (`MAX_IMAGES` in lib/server/batch.ts). */
const MAX_BATCH = 200;
const PICK_TABS = [
  ["all", "全部", {}],
  ["generated", "生成的", { source: "generated" }],
  ["upload", "上傳的", { source: "upload" }],
] as const;

function GalleryPicker({ picked, setPicked }: { picked: string[]; setPicked: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string>();
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);

  async function upload(files: File[]) {
    if (!files.length) return;
    setUploadError(undefined);
    setUploading(files.length);
    try {
      const ids = (await api.upload(files)).map((i) => i.id);
      setPicked([...picked, ...ids.filter((id) => !picked.includes(id))]);
    } catch (err) {
      setUploadError(`上傳失敗：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(0);
    }
  }
  // Dropping or pasting (Ctrl/⌘+V) images works too, without the file picker.
  const { dragging, dropProps } = useImageDrop((files) => void upload(files));

  return (
    <div
      {...dropProps}
      className={`-m-2 flex flex-col gap-2 rounded-xl border-2 border-dashed p-2 transition ${dragging ? "border-accent bg-accent-strong/10" : "border-transparent"}`}
    >
      <div className="flex items-center gap-2">
        <Button className="!py-1 text-xs" onClick={() => setOpen(true)}>
          <Images className="size-3.5" /> 從圖庫選
        </Button>
        {/* A label opens the file picker natively; phones are pickier about input.click(). */}
        <label
          className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium whitespace-nowrap text-muted transition hover:bg-raised hover:text-fg ${
            uploading ? "pointer-events-none opacity-60" : "cursor-pointer"
          }`}
        >
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
          {uploading ? `上傳中 ${uploading} 張…` : "上傳多張"}
          <input
            type="file"
            // Listing the formats makes iPhones hand over JPEG instead of HEIC.
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              void upload(files);
            }}
          />
        </label>
        {picked.length > 0 && (
          <>
            <span className={`ml-auto text-xs tabular-nums ${picked.length > MAX_BATCH ? "text-bad" : "text-muted"}`}>已選 {picked.length} 張</span>
            <Button variant="ghost" className="!py-1 text-xs" onClick={() => setPicked([])}>
              清除
            </Button>
          </>
        )}
      </div>
      <p className="text-[11px] text-faint">{dragging ? "放開以上傳" : "也可以把圖片拖進這裡，或按 Ctrl / ⌘ + V 貼上。"}</p>
      {uploadError && <p className="text-xs text-bad">{uploadError}</p>}
      {picked.length > MAX_BATCH && <p className="text-xs text-bad">一次最多 {MAX_BATCH} 張，請減少一些。</p>}
      {picked.length > 0 && (
        <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
          {picked.map((id) => (
            <div key={id} className="relative">
              <button onClick={() => setOpen(true)} title="打開圖庫檢視">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(id, 160)} alt="" className="size-16 rounded-md border border-line object-cover" />
              </button>
              <button onClick={() => toggle(id)} title="移除" className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-bad text-white">
                <X className="size-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {open && <PickerDialog picked={picked} setPicked={setPicked} onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * The whole library, page by page, with thumbnails big enough to tell images
 * apart and a full-size preview. Shift+click picks a run of images.
 */
function PickerDialog({ picked, setPicked, onClose }: { picked: string[]; setPicked: (ids: string[]) => void; onClose: () => void }) {
  const [tab, setTab] = useState<(typeof PICK_TABS)[number][0]>("all");
  const [q, setQ] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [items, setItems] = useState<ImageRecord[]>([]);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const lastClick = useRef<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);
  const pickedSet = useMemo(() => new Set(picked), [picked]);

  async function load(reset: boolean) {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const before = reset ? undefined : items[items.length - 1]?.createdAt;
      const query = PICK_TABS.find((t) => t[0] === tab)![2];
      const page = await api.images({ before, limit: PICK_PAGE, favorites, q: q.trim() || undefined, media: "image", ...query });
      if (id !== reqId.current) return;
      setItems((cur) => (reset ? page : [...cur, ...page]));
      setMore(page.length === PICK_PAGE);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  // New filters start from the top; typing waits a moment.
  useEffect(() => {
    const t = setTimeout(() => void load(true), q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, favorites]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es[0].isIntersecting && more && !loading && void load(false), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (preview !== null) {
        if (e.key === "Escape") setPreview(null);
        else if (e.key === "ArrowLeft") setPreview((i) => Math.max(0, i! - 1));
        else if (e.key === "ArrowRight") setPreview((i) => Math.min(items.length - 1, i! + 1));
        else if (e.key === " ") {
          e.preventDefault();
          toggle(preview, false);
        } else return;
        e.stopPropagation();
      } else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function toggle(i: number, range: boolean) {
    const id = items[i].id;
    const on = !pickedSet.has(id);
    const from = range && lastClick.current !== null ? Math.min(lastClick.current, i) : i;
    const to = range && lastClick.current !== null ? Math.max(lastClick.current, i) : i;
    const ids = items.slice(from, to + 1).map((r) => r.id);
    lastClick.current = i;
    setPicked(on ? [...picked, ...ids.filter((x) => !pickedSet.has(x))] : picked.filter((x) => !ids.includes(x)));
  }

  const allLoadedPicked = items.length > 0 && items.every((r) => pickedSet.has(r.id));
  const shown = preview !== null ? items[preview] : undefined;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-3 md:px-6">
        <h2 className="text-base font-medium">從圖庫選圖</h2>
        <div className="flex items-center rounded-lg bg-raised p-0.5 text-sm">
          {PICK_TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1 ${tab === k ? "bg-accent-strong text-white" : "text-muted hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Chip on={favorites} onClick={() => setFavorites((v) => !v)}>
          <span className="flex items-center gap-1">
            <Heart className="size-3" /> 只看收藏
          </span>
        </Chip>
        <div className="relative order-last w-full md:order-none md:w-72">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋 prompt 或檔名" className={`${inputCls} !py-1.5 pl-8`} />
        </div>
        <IconButton label="關閉 (Esc)" className="ml-auto" onClick={onClose}>
          <X className="size-5" />
        </IconButton>
      </header>

      <div className="flex-1 overflow-y-auto p-3 md:p-6">
        {items.length === 0 && !loading && <p className="mt-20 text-center text-faint">沒有符合的圖片</p>}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {items.map((r, i) => {
            const on = pickedSet.has(r.id);
            return (
              <div
                key={r.id}
                className={`group relative aspect-square overflow-hidden rounded-lg border-2 bg-panel ${on ? "border-accent" : "border-transparent"}`}
              >
                <button onClick={(e) => toggle(i, e.shiftKey)} title={r.params.prompt || "選取"} className="block size-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(r.id, 320)} alt="" loading="lazy" className={`size-full object-cover transition ${on ? "opacity-80" : ""}`} />
                </button>
                <span
                  className={`pointer-events-none absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full border ${
                    on ? "border-accent bg-accent-strong text-white" : "border-white/70 bg-black/40"
                  }`}
                >
                  {on && <Check className="size-3.5" />}
                </span>
                <button
                  onClick={() => setPreview(i)}
                  title="放大預覽"
                  className="absolute right-1.5 bottom-1.5 grid size-8 place-items-center rounded-full bg-black/70 text-white opacity-0 transition group-hover:opacity-100 hover:bg-accent-strong pointer-coarse:opacity-100"
                >
                  <ZoomIn className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
        <div ref={sentinel} className="grid h-16 place-items-center">
          {loading && <Loader2 className="size-5 animate-spin text-faint" />}
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line bg-panel px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-6">
        <span className={`text-sm tabular-nums ${picked.length > MAX_BATCH ? "text-bad" : ""}`}>
          已選 {picked.length} 張{picked.length > MAX_BATCH && `（最多 ${MAX_BATCH}）`}
        </span>
        <span className="hidden text-xs text-faint md:inline">Shift＋點選一整段</span>
        <Button
          variant="ghost"
          className="!py-1 text-xs"
          disabled={!items.length}
          onClick={() => {
            const ids = items.map((r) => r.id);
            setPicked(allLoadedPicked ? picked.filter((x) => !ids.includes(x)) : [...picked, ...ids.filter((x) => !pickedSet.has(x))]);
          }}
        >
          {allLoadedPicked ? "取消全選" : `全選已載入的 ${items.length}${more ? "+" : ""} 張`}
        </Button>
        {picked.length > 0 && (
          <Button variant="ghost" className="!py-1 text-xs" onClick={() => setPicked([])}>
            全不選
          </Button>
        )}
        <Button variant="primary" className="ml-auto px-5" onClick={onClose}>
          完成
        </Button>
      </footer>

      {shown && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <div className="flex flex-wrap items-center gap-3 px-3 py-3 text-sm md:px-4" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs text-white/60 tabular-nums">
              {preview! + 1} / {items.length}
              {more && "+"}
            </span>
            <Button
              variant={pickedSet.has(shown.id) ? "primary" : "outline"}
              className="!py-1 text-xs"
              onClick={() => toggle(preview!, false)}
            >
              <Check className="size-3.5" /> {pickedSet.has(shown.id) ? "已選取" : "選取這張"}
            </Button>
            <span className="hidden text-xs text-white/40 md:inline">空白鍵選取、← → 換張</span>
            <IconButton label="關閉 (Esc)" className="ml-auto text-white" onClick={() => setPreview(null)}>
              <X className="size-5" />
            </IconButton>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 md:px-16" onClick={(e) => e.stopPropagation()}>
            <ZoomableImage key={shown.id} src={imageUrl(shown.id)} alt={shown.params.prompt} className="checker rounded-lg" />
            <IconButton label="上一張 (←)" className="absolute left-3 bg-black/40" onClick={() => setPreview(Math.max(0, preview! - 1))} disabled={preview === 0}>
              <ChevronLeft className="size-5" />
            </IconButton>
            <IconButton
              label="下一張 (→)"
              className="absolute right-3 bg-black/40"
              onClick={() => {
                if (preview! >= items.length - 2 && more && !loading) void load(false);
                setPreview(Math.min(items.length - 1, preview! + 1));
              }}
              disabled={preview === items.length - 1}
            >
              <ChevronRight className="size-5" />
            </IconButton>
          </div>
          {shown.params.prompt && (
            <p className="mx-auto mb-4 line-clamp-2 max-w-3xl px-4 text-center text-xs text-white/60" onClick={(e) => e.stopPropagation()}>
              {shown.params.prompt}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BatchView({ jobs, onCancel }: { jobs: Job[]; onCancel: () => void }) {
  const done = jobs.filter((j) => j.status === "done").length;
  const failed = jobs.filter((j) => j.status === "error").length;
  const cancelled = jobs.filter((j) => j.status === "cancelled").length;
  const running = jobs.find((j) => j.status === "running");
  const left = jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  const progress = (done + failed + cancelled + (running?.progress ?? 0)) / jobs.length;
  const b = jobs[0].params.batch!;
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-line px-3 py-3 md:px-6 md:py-4">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm" title={jobs[0].params.prompt}>
            {jobs[0].params.prompt}
          </p>
          {left > 0 && (
            <Button variant="danger" className="!py-1 text-xs" onClick={onCancel}>
              <Square className="size-3" /> 取消剩下的 {left} 張
            </Button>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-accent-strong transition-[width]" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="text-xs text-muted tabular-nums">
          完成 {done} / {jobs.length}
          {failed > 0 && <span className="text-bad"> · 失敗 {failed}</span>}
          {cancelled > 0 && ` · 取消 ${cancelled}`}
          {running && ` · 第 ${running.params.batch!.index + 1} 張${running.stage ? `：${running.stage}` : ""} ${Math.round(running.progress * 100)}%`}
          {b.saveTo && <span className="font-mono"> · 另存到 {b.saveTo}</span>}
        </p>
      </div>
      <div className="flex-1 p-3 md:overflow-y-auto md:p-6">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-4">
          {jobs.map((j, i) => (
            <BatchCard key={j.id} job={j} onOpen={() => setOpenIdx(i)} />
          ))}
        </div>
      </div>
      {openIdx !== null && jobs[openIdx] && <BatchViewer jobs={jobs} index={openIdx} setIndex={setOpenIdx} />}
    </div>
  );
}

/** Full-screen look at one result: ← → between images, space (or the buttons) flips to the original, Esc closes. */
function BatchViewer({ jobs, index, setIndex }: { jobs: Job[]; index: number; setIndex: (i: number | null) => void }) {
  const [original, setOriginal] = useState(false);
  const job = jobs[index];
  const result = job.imageId;
  const shown = result && !original ? result : job.params.sourceImageId!;
  const b = job.params.batch!;
  const go = (d: number) => {
    const next = index + d;
    if (next >= 0 && next < jobs.length) setIndex(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIndex(null);
      else if (e.key === "ArrowLeft" && index > 0) setIndex(index - 1);
      else if (e.key === "ArrowRight" && index < jobs.length - 1) setIndex(index + 1);
      else if (e.key === " ") {
        e.preventDefault();
        setOriginal((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, jobs.length, setIndex]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm" onClick={() => setIndex(null)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 text-sm md:px-4" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate text-white/90">{b.name ?? `#${b.index + 1}`}</span>
        <span className="text-xs text-white/50 tabular-nums">
          {index + 1} / {jobs.length}
        </span>
        {result && (
          <div className="flex items-center rounded-lg bg-white/10 p-0.5 text-xs md:ml-4">
            <button onClick={() => setOriginal(false)} className={`rounded-md px-3 py-1 ${!original ? "bg-accent-strong text-white" : "text-white/70 hover:text-white"}`}>
              修改後
            </button>
            <button onClick={() => setOriginal(true)} className={`rounded-md px-3 py-1 ${original ? "bg-accent-strong text-white" : "text-white/70 hover:text-white"}`}>
              原圖
            </button>
          </div>
        )}
        {result && <span className="hidden text-xs text-white/40 md:inline">空白鍵切換</span>}
        <div className="ml-auto flex items-center gap-1">
          {result && (
            <>
              <a href={imageUrl(shown)} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-white/80 hover:bg-white/10">
                <ExternalLink className="size-3.5" /> 新分頁開啟
              </a>
              <Link href={`/?edit=${result}`} className="rounded-md px-2 py-1 text-xs text-white/80 hover:bg-white/10">
                再修
              </Link>
            </>
          )}
          <IconButton label="關閉 (Esc)" onClick={() => setIndex(null)}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-8 md:px-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={shown}
          src={imageUrl(shown)}
          alt={original || !result ? "原圖" : job.params.prompt}
          onClick={(e) => {
            e.stopPropagation();
            if (result) setOriginal((o) => !o);
          }}
          className={`max-h-full max-w-full rounded-lg object-contain ${result ? "cursor-pointer" : ""}`}
        />
        {!result && (
          <span className="absolute top-4 rounded-full bg-black/70 px-3 py-1 text-xs text-white/80">
            {job.status === "error" ? `失敗：${job.error ?? ""}` : job.status === "cancelled" ? "已取消，這是原圖" : "還沒完成，這是原圖"}
          </span>
        )}
        <IconButton label="上一張 (←)" className="absolute left-3 bg-black/40" onClick={(e) => (e.stopPropagation(), go(-1))} disabled={index === 0}>
          <ChevronLeft className="size-5" />
        </IconButton>
        <IconButton label="下一張 (→)" className="absolute right-3 bg-black/40" onClick={(e) => (e.stopPropagation(), go(1))} disabled={index === jobs.length - 1}>
          <ChevronRight className="size-5" />
        </IconButton>
      </div>
    </div>
  );
}

/** The result, with the original in the corner; hover the corner to compare, click to enlarge. */
function BatchCard({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const [compare, setCompare] = useState(false);
  const src = job.params.sourceImageId!;
  const b = job.params.batch!;
  const shown = job.imageId && !compare ? job.imageId : src;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-panel">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl(shown, 640)}
        alt=""
        onClick={onOpen}
        title="點一下放大"
        className={`aspect-square w-full cursor-zoom-in object-contain ${job.imageId || compare ? "" : "opacity-40"} ${job.status === "running" ? "shimmer" : ""}`}
      />
      {job.imageId && (
        <button
          onMouseEnter={() => setCompare(true)}
          onMouseLeave={() => setCompare(false)}
          title="原圖"
          className="absolute top-2 left-2 overflow-hidden rounded-md border border-white/30 shadow"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl(src, 160)} alt="原圖" className="size-12 object-cover" />
        </button>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6 text-xs">
        <span className="min-w-0 flex-1 truncate text-white/80">{b.name ?? `#${b.index + 1}`}</span>
        {job.status === "queued" && <span className="text-white/60">排隊中</span>}
        {job.status === "running" && (
          <span className="flex items-center gap-1 text-white">
            <Loader2 className="size-3 animate-spin" /> {Math.round(job.progress * 100)}%
          </span>
        )}
        {job.status === "cancelled" && <span className="text-white/60">已取消</span>}
        {job.status === "error" && (
          <span className="truncate text-bad" title={job.error}>
            失敗
          </span>
        )}
        {job.status === "done" && job.imageId && (
          <>
            {job.error && (
              <span className="text-[#fab219]" title={job.error}>
                未另存
              </span>
            )}
            <a href={imageUrl(job.imageId)} target="_blank" rel="noreferrer" className="rounded bg-black/60 px-2 py-0.5 text-white opacity-0 group-hover:opacity-100 hover:bg-accent-strong pointer-coarse:opacity-100">
              原尺寸
            </a>
            <Link href={`/?edit=${job.imageId}`} className="rounded bg-black/60 px-2 py-0.5 text-white opacity-0 group-hover:opacity-100 hover:bg-accent-strong pointer-coarse:opacity-100">
              再修
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
