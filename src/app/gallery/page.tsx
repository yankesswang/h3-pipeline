"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Heart,
  Image as ImageIcon,
  Loader2,
  Play,
  Search,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import { api, imageUrl } from "@/lib/client/api";
import type { ImageRecord } from "@/lib/shared/types";
import { ImageInfo } from "@/components/image-info";
import { ZoomableImage } from "@/components/zoomable-image";
import { useStudio } from "@/components/studio-provider";
import { Button, Chip, IconButton, inputCls } from "@/components/ui";

const PAGE = 60;

type Tab = "image" | "video" | "upload";
const TABS = [
  ["image", "圖片", ImageIcon],
  ["video", "影片", Clapperboard],
  ["upload", "上傳", Upload],
] as const;
const TAB_QUERY = {
  image: { source: "generated", media: "image" },
  video: { source: "generated", media: "video" },
  upload: { source: "upload" },
} as const;
const EMPTY: Record<Tab, string> = { image: "還沒有生成的圖片", video: "還沒有生成的影片", upload: "還沒有上傳的圖片" };
const tabOf = (r: ImageRecord): Tab => (r.tool === "upload" ? "upload" : r.media);

export default function GalleryPage() {
  const router = useRouter();
  const { recent, removeImage } = useStudio();
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [favorites, setFavorites] = useState(false);
  // Generated stills, generated clips, or images brought in from outside.
  const [tab, setTab] = useState<Tab>("image");
  const [showInfo, setShowInfo] = useState(false);
  const [q, setQ] = useState("");
  const [more, setMore] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  // Multi-select for deleting many at once. Shift-click selects a range.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const loading = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (reset: boolean) => {
      if (loading.current) return;
      loading.current = true;
      try {
        const before = reset ? undefined : images[images.length - 1]?.createdAt;
        const page = await api.images({ before, limit: PAGE, favorites, q: q.trim() || undefined, ...TAB_QUERY[tab] });
        setImages((cur) => (reset ? page : [...cur, ...page]));
        setMore(page.length === PAGE);
        setLoaded(true);
      } finally {
        loading.current = false;
      }
    },
    [images, favorites, q, tab],
  );

  // Reload from the top when the filters change.
  useEffect(() => {
    const t = setTimeout(() => void load(true), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites, q, tab]);

  // New images from the studio appear at the top without a reload, and edits
  // made elsewhere (favorite, delete) show through.
  const shown = useMemo(() => {
    const byId = new Map(recent.map((r) => [r.id, r]));
    const merged = images.map((c) => byId.get(c.id) ?? c);
    if (favorites || q || !loaded) return merged;
    const newest = images[0]?.createdAt ?? 0;
    return [...recent.filter((r) => r.createdAt > newest && tabOf(r) === tab), ...merged];
  }, [images, recent, favorites, q, loaded, tab]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es[0].isIntersecting && more && void load(false));
    io.observe(el);
    return () => io.disconnect();
  }, [load, more]);

  useEffect(() => {
    if (openIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIdx(null);
      if (e.key === "ArrowRight") setOpenIdx((i) => (i === null ? i : Math.min(shown.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setOpenIdx((i) => (i === null ? i : Math.max(0, i - 1)));
      if (e.key === "i" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) setShowInfo((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIdx, shown.length]);

  const open = openIdx !== null ? shown[openIdx] : undefined;
  const unit = tab === "video" ? "部" : "張";

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
    setAnchor(null);
    setConfirmDelete(false);
  }

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stopSelecting();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  function toggle(i: number, range: boolean) {
    setConfirmDelete(false);
    setSelected((cur) => {
      const next = new Set(cur);
      if (range && anchor !== null) {
        // Shift-click: give the whole range the state of the clicked image's opposite.
        const on = !cur.has(shown[i].id);
        for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) {
          if (on) next.add(shown[k].id);
          else next.delete(shown[k].id);
        }
      } else if (next.has(shown[i].id)) next.delete(shown[i].id);
      else next.add(shown[i].id);
      return next;
    });
    setAnchor(i);
  }

  async function deleteSelected() {
    const ids = [...selected];
    setDeleting(true);
    try {
      await api.deleteImages(ids);
      const gone = new Set(ids);
      setImages((cur) => cur.filter((c) => !gone.has(c.id)));
      for (const id of ids) removeImage(id);
      stopSelecting();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-3 md:px-6">
        <h1 className="text-base font-medium">圖庫</h1>
        <div className="flex items-center rounded-lg bg-raised p-0.5 text-sm md:ml-2">
          {TABS.map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => {
                setTab(k);
                setOpenIdx(null);
                stopSelecting();
              }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 ${tab === k ? "bg-accent-strong text-white" : "text-muted hover:text-fg"}`}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="relative order-last w-full md:order-none md:ml-4 md:w-80">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === "upload" ? "搜尋檔名" : "搜尋 prompt"} className={`${inputCls} !py-1.5 pl-8`} />
        </div>
        <Chip on={favorites} onClick={() => setFavorites((v) => !v)}>
          <span className="flex items-center gap-1">
            <Heart className="size-3" /> 只看收藏
          </span>
        </Chip>
        <span className="ml-auto text-xs text-faint">{shown.length}{more ? "+" : ""} {unit}</span>
        {!selecting && (
          <Button variant="outline" className="!py-1 text-xs" onClick={() => setSelecting(true)}>
            <CheckSquare className="size-3.5" /> 選取
          </Button>
        )}
      </header>

      {selecting && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised/60 px-3 py-2 text-sm md:px-6">
          <span className="tabular-nums">已選 {selected.size} {unit}</span>
          <span className="hidden text-xs text-faint md:inline">點圖片選取，Shift＋點選一整段，Esc 離開</span>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Button variant="ghost" className="!py-1 text-xs" onClick={() => setSelected(new Set(shown.map((s) => s.id)))}>
              全選已載入的 {shown.length} {unit}
            </Button>
            {selected.size > 0 && (
              <Button variant="ghost" className="!py-1 text-xs" onClick={() => setSelected(new Set())}>
                全不選
              </Button>
            )}
            {confirmDelete ? (
              <Button variant="primary" className="!bg-bad !py-1 text-xs hover:!bg-bad/80" onClick={deleteSelected} disabled={deleting}>
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} 確定永久刪除 {selected.size} {unit}
              </Button>
            ) : (
              <Button variant="danger" className="!py-1 text-xs" onClick={() => setConfirmDelete(true)} disabled={selected.size === 0}>
                <Trash2 className="size-3.5" /> 刪除
              </Button>
            )}
            <Button variant="ghost" className="!py-1 text-xs" onClick={stopSelecting}>
              取消
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 md:p-6">
        {shown.length === 0 && !more && <p className="mt-20 text-center text-faint">{EMPTY[tab]}</p>}
        <div className="columns-2 gap-2 md:columns-3 md:gap-3 xl:columns-4 2xl:columns-5">
          {shown.map((img, i) => (
            <button
              key={img.id}
              title={selecting ? "選取圖片" : "開啟圖片並放大檢視"}
              onClick={(e) => (selecting ? toggle(i, e.shiftKey) : setOpenIdx(i))}
              className={`group relative mb-2 block w-full overflow-hidden rounded-lg border break-inside-avoid md:mb-3 ${
                selected.has(img.id) ? "border-accent ring-2 ring-accent/70" : "border-line"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
               <img src={imageUrl(img.id, 640)} alt="" loading="lazy" className="w-full" style={{ aspectRatio: img.width / img.height }} />
              {img.favorite && !selecting && <Heart className="absolute top-2 right-2 size-4 fill-bad text-bad drop-shadow" />}
              {selecting && (
                <span
                  className={`absolute top-2 right-2 grid size-5 place-items-center rounded-md border ${
                    selected.has(img.id) ? "border-accent bg-accent-strong text-white" : "border-white/70 bg-black/40"
                  }`}
                >
                  {selected.has(img.id) && <Check className="size-3.5" />}
                </span>
              )}
              {selected.has(img.id) && <span className="pointer-events-none absolute inset-0 bg-accent/15" />}
              {img.media === "video" && (
                <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px]">
                  <Play className="size-3 fill-white" /> {img.duration?.toFixed(1)}s
                </span>
              )}
              {img.media === "image" && !selecting && (
                <span className="absolute right-2 bottom-2 grid size-8 place-items-center rounded-full bg-black/75 text-white" aria-hidden="true">
                  <ZoomIn className="size-4" />
                </span>
              )}
            </button>
          ))}
        </div>
        <div ref={sentinel} className="h-10" />
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm md:flex-row" onClick={() => setOpenIdx(null)}>
          <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center p-2 md:p-8" onClick={(e) => e.stopPropagation()}>
            { }
            {open.media === "video" ? (
              <video key={open.id} src={imageUrl(open.id)} controls autoPlay loop playsInline className="max-h-full max-w-full rounded-lg bg-black" />
            ) : (
              <ZoomableImage key={open.id} src={imageUrl(open.id)} alt={open.params.prompt} className="checker rounded-lg" />
            )}
            <IconButton label="上一張" className="absolute left-3 bg-black/40" onClick={() => setOpenIdx(Math.max(0, openIdx! - 1))} disabled={openIdx === 0}>
              <ChevronLeft className="size-5" />
            </IconButton>
            <IconButton
              label="下一張"
              className="absolute right-3 bg-black/40"
              onClick={() => setOpenIdx(Math.min(shown.length - 1, openIdx! + 1))}
              disabled={openIdx === shown.length - 1}
            >
              <ChevronRight className="size-5" />
            </IconButton>
          </div>
          <div className="max-h-[45vh] w-full shrink-0 overflow-y-auto border-t border-line bg-panel p-4 md:max-h-none md:w-96 md:border-t-0 md:border-l md:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end md:mb-4">
              <IconButton label="關閉 (Esc)" onClick={() => setOpenIdx(null)}>
                <X className="size-4" />
              </IconButton>
            </div>
            <ImageInfo
              image={open}
              onReuse={(img, lockSeed) => router.push(`/?reuse=${img.id}${lockSeed ? "&seed=1" : ""}`)}
              onEdit={(img) => router.push(`/?edit=${img.id}`)}
              onMakeVideo={(img) => router.push(`/?video=${img.id}`)}
              onContinue={(v) => router.push(`/?continue=${v.id}`)}
              detailsOpen={showInfo}
              onToggleDetails={() => setShowInfo((v) => !v)}
              onDeleted={(id) => {
                setImages((cur) => cur.filter((c) => c.id !== id));
                setOpenIdx((i) => (i !== null && i >= shown.length - 1 ? shown.length - 2 : i));
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
