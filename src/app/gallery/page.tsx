"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Heart, Play, Search, X } from "lucide-react";
import { api, imageUrl } from "@/lib/client/api";
import type { ImageRecord } from "@/lib/shared/types";
import { ImageInfo } from "@/components/image-info";
import { useStudio } from "@/components/studio-provider";
import { Chip, IconButton, inputCls } from "@/components/ui";

const PAGE = 60;

export default function GalleryPage() {
  const router = useRouter();
  const { recent } = useStudio();
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [favorites, setFavorites] = useState(false);
  const [q, setQ] = useState("");
  const [more, setMore] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const loading = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (reset: boolean) => {
      if (loading.current) return;
      loading.current = true;
      try {
        const before = reset ? undefined : images[images.length - 1]?.createdAt;
        const page = await api.images({ before, limit: PAGE, favorites, q: q.trim() || undefined });
        setImages((cur) => (reset ? page : [...cur, ...page]));
        setMore(page.length === PAGE);
        setLoaded(true);
      } finally {
        loading.current = false;
      }
    },
    [images, favorites, q],
  );

  // Reload from the top when the filters change.
  useEffect(() => {
    const t = setTimeout(() => void load(true), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites, q]);

  // New images from the studio appear at the top without a reload, and edits
  // made elsewhere (favorite, delete) show through.
  const shown = useMemo(() => {
    const byId = new Map(recent.map((r) => [r.id, r]));
    const merged = images.map((c) => byId.get(c.id) ?? c);
    if (favorites || q || !loaded) return merged;
    const newest = images[0]?.createdAt ?? 0;
    return [...recent.filter((r) => r.createdAt > newest), ...merged];
  }, [images, recent, favorites, q, loaded]);

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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIdx, shown.length]);

  const open = openIdx !== null ? shown[openIdx] : undefined;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line px-6 py-3">
        <h1 className="text-base font-medium">圖庫</h1>
        <div className="relative ml-4 w-80">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋 prompt" className={`${inputCls} !py-1.5 pl-8`} />
        </div>
        <Chip on={favorites} onClick={() => setFavorites((v) => !v)}>
          <span className="flex items-center gap-1">
            <Heart className="size-3" /> 只看收藏
          </span>
        </Chip>
        <span className="ml-auto text-xs text-faint">{shown.length}{more ? "+" : ""} 張</span>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {shown.length === 0 && !more && <p className="mt-20 text-center text-faint">還沒有圖片</p>}
        <div className="columns-2 gap-3 md:columns-3 xl:columns-4 2xl:columns-5">
          {shown.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setOpenIdx(i)}
              className="group relative mb-3 block w-full overflow-hidden rounded-lg border border-line break-inside-avoid"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
               <img src={imageUrl(img.id, 640)} alt="" loading="lazy" className="w-full" style={{ aspectRatio: img.width / img.height }} />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-8 text-left text-xs opacity-0 transition group-hover:opacity-100">
                <p className="line-clamp-2">{img.params.prompt}</p>
              </div>
              {img.favorite && <Heart className="absolute top-2 right-2 size-4 fill-bad text-bad drop-shadow" />}
              {img.media === "video" && (
                <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px]">
                  <Play className="size-3 fill-white" /> {img.duration?.toFixed(1)}s
                </span>
              )}
            </button>
          ))}
        </div>
        <div ref={sentinel} className="h-10" />
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex bg-black/85 backdrop-blur-sm" onClick={() => setOpenIdx(null)}>
          <div className="relative flex min-w-0 flex-1 items-center justify-center p-8" onClick={(e) => e.stopPropagation()}>
            { }
            {open.media === "video" ? (
              <video key={open.id} src={imageUrl(open.id)} controls autoPlay loop playsInline className="max-h-full max-w-full rounded-lg bg-black" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl(open.id)} alt={open.params.prompt} className="checker max-h-full max-w-full rounded-lg object-contain" />
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
          <div className="w-96 shrink-0 overflow-y-auto border-l border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex justify-end">
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
